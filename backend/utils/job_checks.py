"""
Daily Job Checks Module

Checks daily jobs and business processes:
- Outlook Morning Meeting email
- PowerPoint presentations update status
- Quant output daily files
- Quant output monthly files
"""

from datetime import datetime, date, timedelta
from typing import List, Dict
import sys
import os
import re


def check_morning_meeting_email() -> Dict:
    """Check if the 'Morning Meeting' email exists in Outlook for today."""
    try:
        today_str = datetime.now().strftime("%Y-%m-%d")
        email_subject = f"Morning Meeting - {today_str}"

        if sys.platform != 'win32':
            return {
                'status': 'alert',
                'message': 'Morning Mail',
                'source': 'Outlook Inbox',
                'timestamp': datetime.now().isoformat()
            }

        try:
            import win32com.client  # type: ignore
        except ImportError:
            return {
                'status': 'alert',
                'message': 'Morning Mail',
                'source': 'Outlook Inbox',
                'timestamp': datetime.now().isoformat()
            }

        try:
            outlook = win32com.client.GetObject(Class="Outlook.Application")
        except Exception:
            return {
                'status': 'alert',
                'message': 'Morning Mail',
                'source': 'Outlook (not running)',
                'timestamp': datetime.now().isoformat()
            }

        try:
            mapi_namespace = outlook.GetNamespace("MAPI")
            inbox = mapi_namespace.GetDefaultFolder(6)  # 6 = olFolderInbox
        except Exception:
            return {
                'status': 'alert',
                'message': 'Morning Mail',
                'source': 'Outlook Inbox',
                'timestamp': datetime.now().isoformat()
            }

        try:
            email_found = False
            for item in inbox.Items:
                try:
                    if hasattr(item, 'Subject') and email_subject in item.Subject:
                        email_found = True
                        break
                except Exception:
                    continue

            return {
                'status': 'ok' if email_found else 'alert',
                'message': 'Morning Mail',
                'source': 'Outlook Inbox',
                'timestamp': datetime.now().isoformat()
            }
        except Exception:
            return {
                'status': 'alert',
                'message': 'Morning Mail',
                'source': 'Outlook Inbox',
                'timestamp': datetime.now().isoformat()
            }

    except Exception as e:
        return {
            'status': 'alert',
            'message': 'Morning Mail',
            'source': 'Outlook Inbox',
            'timestamp': datetime.now().isoformat()
        }


def check_presentation_updates() -> Dict:
    r"""
    Check if PowerPoint files ending with '_updated' in X:\Vertrieb\Masterpräsentationen
    have been updated today.
    """
    try:
        folder_path = r'X:\Vertrieb\Masterpräsentationen'

        if not os.path.exists(folder_path):
            return {
                'status': 'alert',
                'message': 'Masterpräsentationen',
                'source': folder_path,
                'timestamp': datetime.now().isoformat()
            }

        today = date.today()
        stale_files = []
        found_files = False

        try:
            for filename in os.listdir(folder_path):
                if filename.endswith('_updated.ppt') or filename.endswith('_updated.pptx'):
                    found_files = True
                    filepath = os.path.join(folder_path, filename)
                    mod_timestamp = os.path.getmtime(filepath)
                    mod_date = datetime.fromtimestamp(mod_timestamp).date()
                    if mod_date < today:
                        stale_files.append({
                            'name': filename,
                            'mod_date': mod_date.strftime('%Y-%m-%d')
                        })
        except Exception:
            return {
                'status': 'alert',
                'message': 'Masterpräsentationen',
                'source': folder_path,
                'timestamp': datetime.now().isoformat()
            }

        if not found_files or stale_files:
            return {
                'status': 'alert',
                'message': 'Masterpräsentationen',
                'source': folder_path,
                'details': stale_files,
                'timestamp': datetime.now().isoformat()
            }

        return {
            'status': 'ok',
            'message': 'Masterpräsentationen',
            'source': folder_path,
            'timestamp': datetime.now().isoformat()
        }

    except Exception:
        return {
            'status': 'alert',
            'message': 'Masterpräsentationen',
            'source': r'X:\Vertrieb\Masterpräsentationen',
            'timestamp': datetime.now().isoformat()
        }


def check_quant_output_updates() -> Dict:
    r"""
    Check if the latest file in the Quant Output daily folder was updated today.
    """
    try:
        folder_path = r'M:\Multi Asset Mgmt\0500_Marketing_Vertrieb\0560_Quant_Output\top_bottom\daily_ytd'

        if not os.path.exists(folder_path):
            return {
                'status': 'alert',
                'message': 'Top Bottom Daily',
                'source': folder_path,
                'timestamp': datetime.now().isoformat()
            }

        today = date.today()
        latest_mod_date = None
        file_count = 0

        try:
            for filename in os.listdir(folder_path):
                filepath = os.path.join(folder_path, filename)
                if os.path.isfile(filepath):
                    file_count += 1
                    mod_timestamp = os.path.getmtime(filepath)
                    mod_date = datetime.fromtimestamp(mod_timestamp).date()
                    if latest_mod_date is None or mod_date > latest_mod_date:
                        latest_mod_date = mod_date
        except Exception:
            return {
                'status': 'alert',
                'message': 'Top Bottom Daily',
                'source': folder_path,
                'timestamp': datetime.now().isoformat()
            }

        if file_count == 0 or (latest_mod_date is not None and latest_mod_date < today):
            return {
                'status': 'alert',
                'message': 'Top Bottom Daily',
                'source': folder_path,
                'timestamp': datetime.now().isoformat()
            }

        return {
            'status': 'ok',
            'message': 'Top Bottom Daily',
            'source': folder_path,
            'timestamp': datetime.now().isoformat()
        }

    except Exception:
        return {
            'status': 'alert',
            'message': 'Top Bottom Daily',
            'source': r'M:\Multi Asset Mgmt\0500_Marketing_Vertrieb\0560_Quant_Output\top_bottom\daily_ytd',
            'timestamp': datetime.now().isoformat()
        }


def check_top_bottom_monthly() -> Dict:
    r"""
    Check if the latest monthly file matches the expected month.
    Days 1-5: Grace period. Days 6-10: Alert if previous month missing. Days 11+: No alert.
    """
    folder_path = r'M:\Multi Asset Mgmt\0500_Marketing_Vertrieb\0560_Quant_Output\top_bottom\monthly_ytd'
    try:
        if not os.path.exists(folder_path):
            return {
                'status': 'alert',
                'message': 'Top Bottom Monthly',
                'source': folder_path,
                'timestamp': datetime.now().isoformat()
            }

        today = date.today()
        day_of_month = today.day

        # Grace period or post-window: no alert
        if day_of_month <= 5 or day_of_month > 10:
            return {
                'status': 'ok',
                'message': 'Top Bottom Monthly',
                'source': folder_path,
                'timestamp': datetime.now().isoformat()
            }

        latest_file_date = None
        try:
            for filename in os.listdir(folder_path):
                filepath = os.path.join(folder_path, filename)
                if os.path.isfile(filepath):
                    date_match = re.search(r'(\d{6})(?:\.\w+)?$', filename)
                    if date_match:
                        date_str = date_match.group(1)
                        if latest_file_date is None or date_str > latest_file_date:
                            latest_file_date = date_str
        except Exception:
            return {
                'status': 'alert',
                'message': 'Top Bottom Monthly',
                'source': folder_path,
                'timestamp': datetime.now().isoformat()
            }

        # Expected: file from previous month
        first_of_this_month = today.replace(day=1)
        last_of_prev_month = first_of_this_month - timedelta(days=1)
        expected_date = last_of_prev_month.strftime('%Y%m')

        if latest_file_date is None or latest_file_date < expected_date:
            return {
                'status': 'alert',
                'message': 'Top Bottom Monthly',
                'source': folder_path,
                'timestamp': datetime.now().isoformat()
            }

        return {
            'status': 'ok',
            'message': 'Top Bottom Monthly',
            'source': folder_path,
            'timestamp': datetime.now().isoformat()
        }

    except Exception:
        return {
            'status': 'alert',
            'message': 'Top Bottom Monthly',
            'source': folder_path,
            'timestamp': datetime.now().isoformat()
        }


def get_daily_job_checks() -> List[Dict]:
    """Return status of all daily job checks."""
    return [
        check_morning_meeting_email(),
        check_presentation_updates(),
        check_quant_output_updates(),
        check_top_bottom_monthly(),
    ]


def has_failed_checks(job_checks: List[Dict]) -> bool:
    """Return True if any check has status 'alert'."""
    return any(c.get('status') == 'alert' for c in job_checks)
