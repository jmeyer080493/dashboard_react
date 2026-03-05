"""
Tests for anleihen_service.py

Run from the backend/ directory:
    python -m pytest tests/test_anleihen_service.py -v

All SQL calls are mocked – no live database required.
"""

import sys
import os
import math
import pytest
import pandas as pd
from unittest.mock import patch, MagicMock

# Make sure the backend package is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


# ---------------------------------------------------------------------------
# Import the module under test (patch DatabaseGateway at import time so no
# real connection is attempted)
# ---------------------------------------------------------------------------
with patch("utils.database.DatabaseGateway"):
    import services.anleihen_service as svc


# ===========================================================================
# Helper-function unit tests  (no SQL, no files)
# ===========================================================================

class TestStandardizeRating:
    def test_moody_aaa(self):
        assert svc._standardize_rating("AAA") == "AAA"

    def test_moody_baa2(self):
        assert svc._standardize_rating("BAA2") == "BBB"

    def test_moody_ba1(self):
        assert svc._standardize_rating("BA1") == "BB+"

    def test_passthrough_sp(self):
        assert svc._standardize_rating("BBB+") == "BBB+"

    def test_passthrough_fitch(self):
        assert svc._standardize_rating("A-") == "A-"

    def test_empty(self):
        assert svc._standardize_rating("") == ""


class TestExtractCategory:
    def test_bbb_plus(self):
        assert svc._extract_category("BBB+") == "BBB"

    def test_aa_minus(self):
        assert svc._extract_category("AA-") == "AA"

    def test_b(self):
        assert svc._extract_category("B") == "B"


class TestGetRatingsFromBond:
    def _row(self, **kwargs):
        return pd.Series(kwargs)

    def test_sp_only(self):
        r = self._row(**{'S&P': 'BBB+', 'Fitch': 'N.A.', 'Moodys': None})
        assert svc._get_ratings_from_bond(r) == ['BBB+']

    def test_all_three(self):
        r = self._row(**{'Moodys': 'BAA2', 'Fitch': 'BBB', 'S&P': 'BBB-'})
        ratings = svc._get_ratings_from_bond(r)
        assert 'BBB' in ratings   # Moody's BAA2 → BBB
        assert 'BBB' in ratings
        assert 'BBB-' in ratings

    def test_all_na(self):
        r = self._row(**{'Moodys': 'N.A.', 'Fitch': 'nan', 'S&P': None})
        assert svc._get_ratings_from_bond(r) == []

    def test_wr_excluded(self):
        r = self._row(**{'Moodys': 'WR', 'S&P': 'A'})
        assert svc._get_ratings_from_bond(r) == ['A']


class TestMergeRatingValues:
    def _row(self, s, l):
        return pd.Series({'short': s, 'long': l})

    def test_both_same(self):
        assert svc._merge_rating_values(self._row('BBB', 'BBB'), 'short', 'long') == 'BBB'

    def test_both_differ(self):
        assert svc._merge_rating_values(self._row('BB', 'BBB'), 'short', 'long') == 'BB / BBB'

    def test_short_na(self):
        assert svc._merge_rating_values(self._row('N.A.', 'AA'), 'short', 'long') == 'AA'

    def test_long_na(self):
        assert svc._merge_rating_values(self._row('AA', float('nan')), 'short', 'long') == 'AA'


class TestMergeAmountColumns:
    def test_pick_max(self):
        row = pd.Series({'a': 100.0, 'b': 200.0, 'c': 150.0})
        assert svc._merge_amount_columns(row, ['a', 'b', 'c']) == 200.0

    def test_all_nan(self):
        row = pd.Series({'a': float('nan'), 'b': None})
        assert svc._merge_amount_columns(row, ['a', 'b']) is None


class TestFormatAmountEu:
    def test_integer(self):
        assert svc._format_amount_eu(1234567.0) == '1.234.567,00'

    def test_na(self):
        assert svc._format_amount_eu(None) == 'N.A.'

    def test_nan(self):
        assert svc._format_amount_eu(float('nan')) == 'N.A.'

    def test_small(self):
        assert svc._format_amount_eu(500.0) == '500,00'


class TestExtractCdsSpread:
    def _row(self, **kwargs):
        return pd.Series(kwargs)

    def test_final_ig(self):
        r = self._row(**{'Final Initial Guidance': '+120bps area', 'Initial Guidance': None, 'IPT': None})
        assert svc._extract_cds_spread(r) == 120.0

    def test_ipt(self):
        r = self._row(**{'Final Initial Guidance': None, 'Initial Guidance': None, 'IPT': 'MS + 95'})
        assert svc._extract_cds_spread(r) == 95.0

    def test_percent_ignored(self):
        r = self._row(**{'Final Initial Guidance': '1.500%', 'Initial Guidance': None, 'IPT': None})
        assert svc._extract_cds_spread(r) is None

    def test_no_columns(self):
        r = self._row(Name='Test Bond')
        assert svc._extract_cds_spread(r) is None


# ===========================================================================
# get_issuance_table  – mock Excel
# ===========================================================================

class TestGetIssuanceTable:
    def _make_df(self):
        return pd.DataFrame({
            'Name': ['Bond A', 'Bond B', 'Bond C'],
            'Currency': ['EUR', 'USD', 'GBP'],
            'Maturity': ['2030-01-01', '2028-06-01', '2031-03-01'],
            'Final Initial Guidance': ['+120', '+80', None],
            'Moodys': ['BBB', 'A', 'N.A.'],
            'Fitch':  ['N.A.', 'A-', 'N.A.'],
            'S&P':    ['BBB+', 'N.A.', 'N.A.'],
            'Offering Amount': [500_000_000.0, None, 200_000_000.0],
        })

    def test_returns_ok_status(self):
        with patch('services.anleihen_service.pd.read_excel', return_value=self._make_df()):
            result = svc.get_issuance_table()
        assert result['status'] == 'ok'

    def test_all_na_rating_filtered_out(self):
        """Bond C has all N.A. ratings – should be dropped."""
        with patch('services.anleihen_service.pd.read_excel', return_value=self._make_df()):
            result = svc.get_issuance_table()
        names = [r['Name'] for r in result['rows']]
        assert 'Bond C' not in names
        assert 'Bond A' in names

    def test_offering_amount_merged(self):
        with patch('services.anleihen_service.pd.read_excel', return_value=self._make_df()):
            result = svc.get_issuance_table()
        assert 'Amount Local' in result['columns']
        assert 'Offering Amount' not in result['columns']

    def test_error_returns_error_status(self):
        with patch('services.anleihen_service.pd.read_excel', side_effect=FileNotFoundError('missing')):
            result = svc.get_issuance_table()
        assert result['status'] == 'error'
        assert result['rows'] == []


# ===========================================================================
# get_checks_table  – mock SQL
# ===========================================================================

class TestGetChecksTable:
    def _checks_df(self):
        return pd.DataFrame({
            'Fonds': ['AMB', 'AVW', 'Kini'],
            'Investmentansatz': ['Renten', 'Renten', 'Aktien/Renten Aktiv'],
            'Länder / Universum': ['EU', 'EU', 'Global'],
            'Währung': ['EUR', 'EUR', 'EUR'],
            'Min. Rating': ['BBB-', 'BBB', 'B'],
            'Rating-logik': ['avg', 'avg', 'worst'],
            'max. FX-Exposure': ['10%', '5%', '20%'],
            'max. Corporates': ['50%', '40%', '30%'],
        })

    def test_returns_ok_status(self):
        mock_engine = MagicMock()
        with patch.object(svc.db, 'get_duoplus_engine', return_value=mock_engine):
            with patch('services.anleihen_service.pd.read_sql_query', return_value=self._checks_df()):
                result = svc.get_checks_table()
        assert result['status'] == 'ok'

    def test_kini_excluded(self):
        mock_engine = MagicMock()
        with patch.object(svc.db, 'get_duoplus_engine', return_value=mock_engine):
            with patch('services.anleihen_service.pd.read_sql_query', return_value=self._checks_df()):
                result = svc.get_checks_table()
        fonds_list = [r['Fonds'] for r in result['rows']]
        assert 'Kini' not in fonds_list

    def test_non_renten_excluded(self):
        """Rows without 'Renten' in Investmentansatz should be dropped."""
        mock_engine = MagicMock()
        with patch.object(svc.db, 'get_duoplus_engine', return_value=mock_engine):
            with patch('services.anleihen_service.pd.read_sql_query', return_value=self._checks_df()):
                result = svc.get_checks_table()
        # 'Kini' had Aktien/Renten Aktiv – excluded. AMB and AVW should remain.
        fonds_list = [r['Fonds'] for r in result['rows']]
        assert 'AMB' in fonds_list
        assert 'AVW' in fonds_list

    def test_sql_error_returns_error_status(self):
        mock_engine = MagicMock()
        with patch.object(svc.db, 'get_duoplus_engine', return_value=mock_engine):
            with patch('services.anleihen_service.pd.read_sql_query', side_effect=Exception('DB down')):
                result = svc.get_checks_table()
        assert result['status'] == 'error'


# ===========================================================================
# get_chart_data  – mock SQL helpers
# ===========================================================================

class TestGetChartData:
    def _eur_bond(self):
        return {
            'Name': 'Test Corp 2030',
            'Currency': 'EUR',
            'Maturity': '2030-01-01',
            'Final Initial Guidance': '+120bps',
        }

    def _cds_df(self):
        return pd.DataFrame({
            'DatePoint': [pd.Timestamp('2026-03-01')],
            '3 CDS': [65.0],
            '5 CDS': [72.0],
            '7 CDS': [78.0],
            '10 CDS': [85.0],
            'Regions': ['Europe'],
        })

    def _asw_df(self):
        return pd.DataFrame({
            'Tenor': [3, 5, 7, 10],
            'ASW_Spread': [45.0, 52.0, 58.0, 64.0],
            'Label': ['BBB Composite 3Y', 'BBB Composite 5Y', 'BBB Composite 7Y', 'BBB Composite 10Y'],
            'Rating_Value': ['BBB', 'BBB', 'BBB', 'BBB'],
        })

    def test_eur_bond_returns_ok(self):
        with patch.object(svc, 'get_cds_data_for_currency', return_value=self._cds_df()):
            with patch.object(svc, 'get_asw_spreads_for_bond', return_value=self._asw_df()):
                result = svc.get_chart_data(self._eur_bond())
        assert result['status'] == 'ok'

    def test_cds_curve_populated(self):
        with patch.object(svc, 'get_cds_data_for_currency', return_value=self._cds_df()):
            with patch.object(svc, 'get_asw_spreads_for_bond', return_value=self._asw_df()):
                result = svc.get_chart_data(self._eur_bond())
        assert len(result['cds_curve']) > 0
        tenors = [p['tenor'] for p in result['cds_curve']]
        assert '5Y' in tenors

    def test_asw_curves_populated(self):
        with patch.object(svc, 'get_cds_data_for_currency', return_value=self._cds_df()):
            with patch.object(svc, 'get_asw_spreads_for_bond', return_value=self._asw_df()):
                result = svc.get_chart_data(self._eur_bond())
        assert 'BBB' in result['asw_curves']

    def test_bond_point_set(self):
        with patch.object(svc, 'get_cds_data_for_currency', return_value=self._cds_df()):
            with patch.object(svc, 'get_asw_spreads_for_bond', return_value=self._asw_df()):
                result = svc.get_chart_data(self._eur_bond())
        assert result['bond_point'] is not None
        assert result['bond_point']['cds_spread'] == 120.0

    def test_non_eur_usd_skips_queries(self):
        bond = {'Name': 'EM Bond', 'Currency': 'BRL', 'Maturity': '2030-01-01'}
        with patch.object(svc, 'get_cds_data_for_currency') as mock_cds:
            result = svc.get_chart_data(bond)
        mock_cds.assert_not_called()
        assert result['metadata']['supported'] is False

    def test_empty_cds_df(self):
        with patch.object(svc, 'get_cds_data_for_currency', return_value=pd.DataFrame()):
            with patch.object(svc, 'get_asw_spreads_for_bond', return_value=pd.DataFrame()):
                result = svc.get_chart_data(self._eur_bond())
        assert result['status'] == 'ok'
        assert result['cds_curve'] == []
        assert result['bond_point'] is None
