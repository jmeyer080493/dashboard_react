"""
Export utilities ported from the original dashboard project.

Adapts the original Plotly-based build_excel / build_pptx functions
to work with the React dashboard's chartData row format:
  chartData = [{xKey: "2024-01-01", Region1: 1.5, Region2: 2.0, ...}, ...]
"""
import io
import os
import math
from statistics import mean

import pandas as pd

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.util import Pt
from pptx.enum.chart import (
    XL_CHART_TYPE,
    XL_MARKER_STYLE,
    XL_LEGEND_POSITION,
    XL_TICK_LABEL_POSITION,
)
from pptx.dml.color import RGBColor
from lxml import etree
from pptx.oxml.xmlchemy import OxmlElement

# ── Template path ─────────────────────────────────────────────────────────────
_TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "..", "pptx_template.pptx")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers shared by Excel and PPTX
# ─────────────────────────────────────────────────────────────────────────────

def _chartdata_to_traces(chart_data: list, regions: list, x_key: str) -> list:
    """
    Convert recharts row-format data to Plotly-like scatter trace list.
    Skips any region whose values are all non-numeric (e.g. string metadata columns).
    Handles both plain region keys ('Germany') and metric-prefixed keys
    ('Germany_BEST_PE_RATIO'), using only the prefix as the display name.
    """
    traces = []
    for region in regions:
        x_vals = [row.get(x_key) for row in chart_data]
        y_vals = [row.get(region) for row in chart_data]
        # Only include traces with at least one numeric value
        has_numeric = any(
            isinstance(v, (int, float)) and not (isinstance(v, float) and (math.isnan(v) or math.isinf(v)))
            for v in y_vals
        )
        if not has_numeric:
            continue
        # Use only the part before the first '_' as display name (e.g. "Germany_PE" → "Germany")
        display_name = region.split("_")[0] if "_" in region else region
        traces.append({
            "type": "scatter",
            "name": display_name,
            "x": x_vals,
            "y": y_vals,
            "showlegend": True,
        })
    return traces


def _clean_chart_values(values: list) -> list:
    """Replace NaN/Inf/non-numeric values with None so python-pptx skips them gracefully."""
    cleaned = []
    for v in values:
        if v is None:
            cleaned.append(None)
        elif isinstance(v, (int, float)):
            cleaned.append(None if (math.isnan(v) or math.isinf(v)) else v)
        else:
            # Strings and other non-numeric types → None
            cleaned.append(None)
    return cleaned


# ─────────────────────────────────────────────────────────────────────────────
# Excel export  (mirrors original build_excel, but reads our trace format)
# ─────────────────────────────────────────────────────────────────────────────

def build_excel(items: list) -> bytes:
    """
    Build an Excel workbook from a list of chart items.

    Items are grouped by their 'group' value; same group = same sheet.
    Each chart is placed side-by-side (advancing startcol) with its title
    written to row 0.

    Item shape:
      {
        "title": str,
        "group": int,
        "chartData": list[dict],   # row objects
        "regions": list[str],
        "xKey": str,
      }
    """
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="xlsxwriter") as writer:
        grouped: dict[int, list] = {}
        for it in items:
            grp = it.get("group", 1)
            grouped.setdefault(grp, []).append(it)

        for gnum in sorted(grouped):
            sheet_name = f"Group{gnum}"
            startcol = 0

            for it in grouped[gnum]:
                chart_data = it.get("chartData") or []
                regions = it.get("regions") or []
                x_key = it.get("xKey") or "DatePoint"

                if not chart_data:
                    continue

                # Build traces like the original (x + y series per region)
                traces = _chartdata_to_traces(chart_data, regions, x_key)

                # Filter out flat / all-None traces (mirrors original)
                valid_traces = []
                for tr in traces:
                    y = tr.get("y", [])
                    non_null = [v for v in y if v is not None and not (isinstance(v, float) and math.isnan(v))]
                    if len(non_null) > 1 and len(set(non_null)) == 1:
                        continue   # flat line – skip
                    valid_traces.append(tr)

                if not valid_traces:
                    continue

                # Build DataFrame: x column + one column per region
                series = []
                x = valid_traces[0].get("x", [])
                series.append(pd.Series(x, name="x"))
                for idx, tr in enumerate(valid_traces, start=1):
                    nm = tr.get("name") or f"series{idx}"
                    series.append(pd.Series(tr.get("y", []), name=nm))
                df = pd.concat(series, axis=1)

                # Write to sheet: title in row 0, data from row 1
                df.to_excel(
                    writer,
                    sheet_name=sheet_name,
                    startrow=1,
                    startcol=startcol,
                    index=False,
                )
                worksheet = writer.sheets[sheet_name]
                worksheet.write(0, startcol, it["title"])

                startcol += df.shape[1] + 1  # advance for next chart

    buf.seek(0)
    return buf.read()


# ─────────────────────────────────────────────────────────────────────────────
# PPTX helpers  (ported from original pptx_download.py)
# ─────────────────────────────────────────────────────────────────────────────

def _set_date_format(chart, date_format: str):
    cat_axis_xml = chart.category_axis._element
    for num_fmt in cat_axis_xml.findall(".//c:numFmt", namespaces=cat_axis_xml.nsmap):
        num_fmt.set("formatCode", date_format)
        num_fmt.set("sourceLinked", "0")


def _set_value_format(chart, number_format: str):
    val_axis_xml = chart.value_axis._element
    nsmap = val_axis_xml.nsmap
    num_fmt_elems = val_axis_xml.findall(".//c:numFmt", namespaces=nsmap)
    if num_fmt_elems:
        for num_fmt in num_fmt_elems:
            num_fmt.set("formatCode", number_format)
            num_fmt.set("sourceLinked", "0")
    else:
        ns = nsmap.get("c", "http://schemas.openxmlformats.org/drawingml/2006/chart")
        num_fmt = etree.Element(f"{{{ns}}}numFmt", formatCode=number_format, sourceLinked="0")
        scaling = val_axis_xml.find("c:scaling", namespaces=nsmap)
        if scaling is not None:
            val_axis_xml.insert(list(val_axis_xml).index(scaling) + 1, num_fmt)
        else:
            val_axis_xml.insert(0, num_fmt)


def _set_precision(span: float, target_ticks: int = 10) -> float:
    if span <= 0:
        return 1.0
    raw_step = span / float(target_ticks)
    exp = math.floor(math.log10(raw_step))
    mantissa = raw_step / (10 ** exp)
    if   mantissa <= 1: nice_m = 1
    elif mantissa <= 2: nice_m = 2
    elif mantissa <= 5: nice_m = 5
    else:               nice_m = 10
    return nice_m * (10 ** exp)


def _round_to_precision(number: float, precision: float, direction: str) -> float:
    decimal_places = len(str(precision).split(".")[1]) if "." in str(precision) else 0
    if direction == "up":
        return round(number + (precision - (number % precision)) if number % precision != 0 else number, decimal_places)
    else:
        return round(number - (number % precision), decimal_places)


def _SubElement(parent, tagname: str, **kwargs):
    element = OxmlElement(tagname)
    element.attrib.update(kwargs)
    parent.append(element)
    return element


def _set_cross_between(chart, value: str = "midCat"):
    val_axis_xml = chart.value_axis._element
    cross = val_axis_xml.find(".//c:crossBetween", namespaces=val_axis_xml.nsmap)
    if cross is not None:
        cross.set("val", value)
    else:
        cross = etree.Element(
            "{http://schemas.openxmlformats.org/drawingml/2006/chart}crossBetween",
            val=value,
        )
        val_axis_xml.append(cross)


def _add_scatter_chart(traces: list, item: dict, chart_pl) -> bool:
    """
    Insert a line chart into a PowerPoint chart placeholder.
    `traces` is a list of Plotly-like trace dicts with 'x', 'y', 'name'.
    Mirrors the original _add_scatter_chart function.
    """
    scatter_traces = [
        tr for tr in traces
        if tr.get("x") and tr.get("y") and tr.get("showlegend", True)
    ]
    if not scatter_traces:
        return False

    # Build long DataFrame then pivot
    rows = []
    for tr in scatter_traces:
        for x, y in zip(tr["x"], tr["y"]):
            rows.append({"Date": x, "Series": tr["name"], "Value": y})
    df_long = pd.DataFrame(rows)
    if df_long.empty:
        return False

    df = df_long.groupby(["Date", "Series"])["Value"].first().unstack()
    col_order = [tr["name"] for tr in scatter_traces]
    existing_cols = [c for c in col_order if c in df.columns]
    df = df[existing_cols].reset_index()
    if "Date" in df.columns:
        df = df.set_index("Date")
    try:
        df.index = pd.to_datetime(df.index)
    except Exception:
        pass

    df_interp = df.copy()
    try:
        df_interp = df.interpolate(method="linear")
    except Exception:
        pass

    chart_data = CategoryChartData()
    chart_data.categories = df.index.tolist()
    for col in df.columns:
        chart_data.add_series(col, _clean_chart_values(df_interp[col].tolist()))

    chart_type_enum = XL_CHART_TYPE.LINE_MARKERS
    frame = chart_pl.insert_chart(chart_type_enum, chart_data)
    chart = frame.chart

    for series in chart.series:
        series.format.line.width = Pt(3)
        series.format.line.fill.solid()
        series.marker.style = XL_MARKER_STYLE.NONE

    if len(df.columns) > 1:
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.font.size = Pt(12)
    else:
        chart.has_legend = False

    chart.category_axis.tick_labels.font.size = Pt(12)
    chart.value_axis.tick_labels.font.size = Pt(12)
    chart.has_title = False
    chart.value_axis.major_gridlines.format.line.color.rgb = RGBColor(130, 135, 150)

    try:
        all_vals = df.values.flatten()
        all_vals = [v for v in all_vals if v is not None and not (isinstance(v, float) and math.isnan(v))]
        if all_vals:
            maxv = float(max(all_vals))
            minv = float(min(all_vals))
            prec = _set_precision(maxv - minv)
            chart.value_axis.minimum_scale = float(_round_to_precision(minv, prec, "down"))
            chart.value_axis.maximum_scale = float(_round_to_precision(maxv, prec, "up"))
    except Exception:
        pass

    sub = item.get("subheading", "")
    try:
        all_vals2 = df.values.flatten()
        all_vals2 = [v for v in all_vals2 if v is not None and not (isinstance(v, float) and math.isnan(v))]
        distance = max(abs(min(all_vals2)), abs(max(all_vals2))) if all_vals2 else 100
    except Exception:
        distance = 100
    if "Prozent" in sub:
        fmt = "#,##0" if distance > 20 else "#,##0.0"
    else:
        fmt = "#,##0.0" if distance < 20 else "#,##0"
    _set_value_format(chart, fmt)

    chart.category_axis.tick_label_position = XL_TICK_LABEL_POSITION.LOW
    if df.index is not None and len(df.index) > 1:
        try:
            days_diff = (df.index[-1] - df.index[0]).days
            if days_diff > 2000:
                _SubElement(chart.category_axis.format.element, "c:majorUnit", val="2")
                _SubElement(chart.category_axis.format.element, "c:majorTimeUnit", val="years")
                _set_date_format(chart, "yyyy")
            elif days_diff > 1000:
                _SubElement(chart.category_axis.format.element, "c:majorTimeUnit", val="years")
                _set_date_format(chart, "yyyy")
            elif days_diff < 60:
                _SubElement(chart.category_axis.format.element, "c:majorUnit", val="5")
                _set_date_format(chart, r"m\/d;@")
            else:
                _SubElement(chart.category_axis.format.element, "c:majorTimeUnit", val="months")
                _set_date_format(chart, r"m\/yy;@" if days_diff > 370 else "mmm.")
        except Exception:
            pass

    _set_cross_between(chart)
    return True


def _get_layouts():
    """Load template and parse layout map (mirrors original get_layouts)."""
    template_path = os.path.abspath(_TEMPLATE_PATH)
    prs = Presentation(template_path)
    layouts = prs.slide_layouts
    layout_map = {}

    for i, lay in enumerate(layouts):
        count = 0
        chart_ph_indices = []
        text_ph_indices = []
        source_ph_indices = []
        text_ph_widths = []
        text_ph_heights = []
        text_ph_idents = []

        for shape in lay.shapes:
            name_parts = shape.name.split(" ")
            kind = name_parts[0]
            if kind == "Diagrammplatzhalter":
                chart_ph_indices.append(shape.placeholder_format.idx)
                count += 1
            elif kind == "Textplatzhalter":
                text_ph_indices.append(shape.placeholder_format.idx)
                text_ph_widths.append(shape.width)
                text_ph_heights.append(shape.height)
                text_ph_idents.append(name_parts[1] if len(name_parts) > 1 else str(i))
            elif kind == "Inhaltsplatzhalter":
                source_ph_indices.append(shape.placeholder_format.idx)

        layout_map[i] = {
            count: {
                "Diagrammplatzhalter": {"Index": chart_ph_indices},
                "Textplatzhalter": {
                    "Index": text_ph_indices,
                    "Width": text_ph_widths,
                    "Height": text_ph_heights,
                    "Ident": text_ph_idents,
                },
                "Inhaltsplatzhalter": {"Index": source_ph_indices},
            }
        }

    return layout_map, layouts, prs


# ─────────────────────────────────────────────────────────────────────────────
# PPTX export  (mirrors original build_pptx)
# ─────────────────────────────────────────────────────────────────────────────

def build_pptx(items: list) -> bytes:
    """
    Build a PowerPoint file from a list of chart items using pptx_template.pptx.

    Item shape:
      {
        "title": str,          # full display title
        "pptx_title": str,     # optional short slide title (falls back to title)
        "subheading": str,     # optional subtitle text
        "source": str,         # optional source text
        "group": int,          # slide group (same group = same slide)
        "chartData": list,
        "regions": list[str],
        "xKey": str,
      }
    """
    layout_map, layouts, prs = _get_layouts()

    # Remove all existing slides from template
    for sldNum in range(len(prs.slides))[::-1]:
        rId = prs.slides._sldIdLst[sldNum].rId
        prs.part.drop_rel(rId)
        del prs.slides._sldIdLst[sldNum]

    individual_groupings = [it.get("group", 1) for it in items]
    unique_groupings = list(dict.fromkeys(individual_groupings))  # preserve order

    available_sizes = sorted(
        {size for layout_counts in layout_map.values() for size in layout_counts.keys()},
        reverse=True,
    )

    def _process_slide_items(slide_items: list, layout_size: int, layout_index: int):
        """Add one slide for the given items using the given layout."""
        lay = layouts[layout_index]
        slide = prs.slides.add_slide(lay)
        try:
            slide.shapes.title.text = "Add Title"
        except Exception:
            pass

        for c, item in enumerate(slide_items):
            placeholders = slide.placeholders
            try:
                idx_chart  = layout_map[layout_index][layout_size]["Diagrammplatzhalter"]["Index"][c]
                idx_source = layout_map[layout_index][layout_size]["Inhaltsplatzhalter"]["Index"][c]
                text_info  = layout_map[layout_index][layout_size]["Textplatzhalter"]
                text_idxs  = list(text_info["Index"])
                heights    = text_info["Height"]
            except Exception:
                continue

            if layout_size == 1:
                box = heights.index(max(heights))
                del text_idxs[box]
                heading_idx, sub_idx = text_idxs
            elif layout_size == 2:
                box = heights.index(max(heights))
                del text_idxs[box]
                heading_idx = text_idxs[c * 2]
                sub_idx     = text_idxs[c * 2 + 1]
            else:
                heading_idx = text_idxs[2 * c]
                sub_idx     = text_idxs[2 * c + 1]

            placeholders[heading_idx].text = item.get("pptx_title") or item["title"]
            placeholders[sub_idx].text     = item.get("subheading", "")
            placeholders[idx_source].text  = item.get("source", "")

            chart_pl = placeholders[idx_chart]

            # Convert our row data to Plotly-like scatter traces
            traces = _chartdata_to_traces(
                item.get("chartData") or [],
                item.get("regions") or [],
                item.get("xKey") or "DatePoint",
            )

            _add_scatter_chart(traces, item, chart_pl)

    for grouping in unique_groupings:
        filtered_items = [it for it in items if it.get("group", 1) == grouping]
        count = len(filtered_items)

        # Find exact layout
        layout_index = next((k for k, v in layout_map.items() if count in v), None)

        if layout_index is not None:
            _process_slide_items(filtered_items, count, layout_index)
        else:
            # Split into chunks that fit available layouts
            items_remaining = list(filtered_items)
            while items_remaining:
                best_size = next((s for s in available_sizes if s <= len(items_remaining)), None)
                if best_size is None:
                    best_size = min(available_sizes)
                slide_batch = items_remaining[:best_size]
                items_remaining = items_remaining[best_size:]
                li = next((k for k, v in layout_map.items() if best_size in v), None)
                if li is None:
                    continue
                _process_slide_items(slide_batch, best_size, li)

    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    return buf.read()
