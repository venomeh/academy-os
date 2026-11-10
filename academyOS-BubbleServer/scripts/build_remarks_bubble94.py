#!/usr/bin/env python3
"""Build <YOUR_BUBBLE_APP>-94.bubble with §9 teacher remarks APIs + queue popup."""

from __future__ import annotations

import copy
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "academy-os-93.bubble"
DST = ROOT / "academy-os-94.bubble"

TEACHER_JWT = None  # filled from existing teacher call
ANON = os.environ.get("SUPABASE_ANON_KEY", "<SUPABASE_ANON_KEY>")
BASE = os.environ.get("SUPABASE_URL", "https://<PROJECT_REF>.supabase.co")
G3 = "00000000-0000-0000-0000-fffffffffffe"
PAGE_ID = "bTGMq0"
AUTH_EL = "bTGRo"


def field(name: str, btype: str, sample):
    return {
        f"_api_c2_{name}": {
            "ret_btype": btype,
            "caption": name,
            "sample_value": sample,
            "path": [name],
        }
    }


def types_wrapped(provider: str, cid: str, caption: str, body_fields: dict, is_list: bool) -> str:
    body_key = f"{provider}.{cid}.body"
    top_key = f"{provider}.{cid}"
    err_key = f"{provider}.{cid}.error"
    hdr_key = f"{provider}.{cid}.headers"
    body_ret = f"list.api.{body_key}" if is_list else f"api.{body_key}"
    types = {
        top_key: {
            "caption": caption,
            "fields": {
                "_api_c2_body": {
                    "ret_btype": body_ret,
                    "caption": "body",
                    "path": ["body"],
                },
                "_api_c2_error": {
                    "ret_btype": f"api.{err_key}",
                    "caption": "error",
                    "path": ["error"],
                },
                "_api_c2_returned_an_error": {
                    "ret_btype": "boolean",
                    "caption": "returned_an_error",
                    "sample_value": False,
                    "path": ["returned_an_error"],
                },
                "_api_c2_headers": {
                    "ret_btype": f"api.{hdr_key}",
                    "caption": "headers",
                    "path": ["headers"],
                },
            },
        },
        body_key: {"caption": f"{caption} body", "fields": body_fields},
        err_key: {
            "caption": f"{caption} error",
            "fields": {
                **field("status_code", "number", 200),
                **field("status_message", "text", "string value"),
                **field("body", "text", "string value"),
            },
        },
        hdr_key: {
            "caption": f"{caption} headers",
            "fields": {
                **field("date", "date", "string value"),
                **field("content-type", "text", "string value"),
            },
        },
    }
    return json.dumps(types, separators=(",", ":"))


def types_flat(provider: str, cid: str, caption: str, fields: dict) -> str:
    types = {f"{provider}.{cid}": {"caption": caption, "fields": fields}}
    return json.dumps(types, separators=(",", ":"))


def headers(hid_auth: str, hid_ct: str, token: str) -> dict:
    return {
        hid_auth: {"key": "Authorization", "value": f"Bearer {token}", "private": False},
        hid_ct: {"key": "Content-Type", "value": "application/json", "private": False},
    }


def body_params(items: list[tuple[str, str, str]]) -> dict:
    out = {}
    for pid, key, value in items:
        row = {"key": key, "value": value, "private": False}
        out[pid] = row
    return out


def text_expr(*parts):
    entries = {}
    for i, part in enumerate(parts):
        entries[str(i)] = part
    return {"entries": entries, "type": "TextExpression"}


def auth_header_expr():
    return text_expr(
        "Bearer ",
        {
            "next": {"type": "Message", "name": "custom.text_", "is_slidable": False},
            "properties": {"element_id": AUTH_EL},
            "type": "GetElement",
            "is_slidable": False,
        },
        "",
    )


def page_state(name: str):
    return {
        "next": {"type": "Message", "name": name, "is_slidable": False},
        "properties": {"element_id": PAGE_ID},
        "type": "GetElement",
        "is_slidable": False,
    }


def parent_field(name: str):
    return {
        "next": {"type": "Message", "name": name, "is_slidable": False},
        "type": "ElementParent",
        "is_slidable": False,
    }


def nid_factory(existing: set[str]):
    n = 0

    def nid(prefix: str = "bTL") -> str:
        nonlocal n
        while True:
            val = f"{prefix}{n:04d}"
            n += 1
            if val not in existing:
                existing.add(val)
                return val

    return nid


def remap_ids(obj, mapping: dict[str, str]):
    if isinstance(obj, dict):
        return {remap_ids(k, mapping) if isinstance(k, str) else k: remap_ids(v, mapping) for k, v in obj.items()}
    if isinstance(obj, list):
        return [remap_ids(v, mapping) for v in obj]
    if isinstance(obj, str):
        for old, new in mapping.items():
            if old in obj:
                obj = obj.replace(old, new)
        return obj
    return obj


def collect_bt_ids(obj, acc: set[str]):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(k, str) and re.fullmatch(r"bT[A-Za-z0-9]+", k):
                acc.add(k)
            collect_bt_ids(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            collect_bt_ids(v, acc)
    elif isinstance(obj, str) and re.fullmatch(r"bT[A-Za-z0-9]+", obj):
        acc.add(obj)


def api_call_action(call_ref: str, action_id: str, extra_props: dict) -> dict:
    props = {
        "headers_Authorization": auth_header_expr(),
        "headers_Content-Type": text_expr("application/json"),
        **extra_props,
    }
    return {"properties": props, "type": call_ref, "id": action_id}


def main() -> None:
    data = json.loads(SRC.read_text())
    teacher_calls = data["settings"]["client_safe"]["apiconnector2"]["bTHpr"]["calls"]
    main_calls = data["settings"]["client_safe"]["apiconnector2"]["bTGMS0"]["calls"]
    global TEACHER_JWT
    TEACHER_JWT = teacher_calls["bTHrA"]["headers"]["bTHrF"]["value"].replace("Bearer ", "")
    admin_jwt = main_calls["bTJhA"]["headers"]["bTJhB"]["value"].replace("Bearer ", "")

    existing = set(re.findall(r"bT[A-Za-z0-9]+", SRC.read_text()))
    nid = nid_factory(existing)

    queue_fields = {}
    for name, btype, sample in [
        ("remark_id", "text", "00000000-0000-0000-0000-000000000001"),
        ("student_id", "text", "00000000-0000-0000-0000-eeeeeeeeee01"),
        ("student_name", "text", "Sara Ali"),
        ("batch_id", "text", G3),
        ("batch_name", "text", "Grade 3 Morning"),
        ("period_text", "text", "2026-08"),
        ("status", "text", "draft"),
        ("language", "text", "en"),
        ("draft_text", "text", "Sara attended 100% of marked days."),
        ("final_text", "text", "Sara attended 100% of marked days."),
        ("low_data", "boolean", False),
        ("low_data_reason", "text", ""),
        ("attendance_pct", "number", 100),
        ("attendance_total_days", "number", 6),
        ("published_tests_count", "number", 2),
        ("tests_summary", "text", "Math 80% (batch avg 72%)"),
        ("trend_text", "text", "stable"),
        ("approved_at_text", "text", ""),
        ("approved_by_name", "text", ""),
    ]:
        queue_fields.update(field(name, btype, sample))

    teacher_calls["bTLQ0"] = {
        "body": '{ "p_batch_id": "<p_batch_id>", "p_month": "<p_month>", "p_status": "<p_status>", "p_bust": "<p_bust>" }',
        "name": "Get Teacher Remark Queue",
        "url": f"{BASE}/rest/v1/rpc/get_teacher_remark_queue?limit=[limit]",
        "rank": 8,
        "types": types_wrapped("bTHpr", "bTLQ0", "Get Teacher Remark Queue", queue_fields, True),
        "method": "post",
        "headers": headers("bTLQ1", "bTLQ2", TEACHER_JWT),
        "ret_value": "api.apiconnector2.bTHpr.bTLQ0",
        "publish_as": "data",
        "url_params": {"bTLQ3": {"key": "limit", "value": "500", "private": False}},
        "wrap_error": True,
        "body_params": body_params(
            [
                ("bTLQ4", "p_batch_id", G3),
                ("bTLQ5", "p_month", "2026-08"),
                ("bTLQ6", "p_status", "all"),
                ("bTLQ7", "p_bust", "1"),
            ]
        ),
        "get_headers": True,
        "initialized": True,
        "must_reinitialize": False,
        "should_reinitialize": False,
        "url_cant_be_private": True,
        "response_schema_truncated": False,
    }

    review_fields = {}
    for name, btype, sample in [
        ("success", "boolean", True),
        ("action", "text", "approve"),
        ("remark_id", "text", "00000000-0000-0000-0000-000000000001"),
    ]:
        review_fields.update(field(name, btype, sample))

    teacher_calls["bTLR0"] = {
        "body": '{ "p_remark_id": "<p_remark_id>", "p_action": "<p_action>", "p_final_text": "<p_final_text>" }',
        "name": "Review Teacher Remark",
        "url": f"{BASE}/rest/v1/rpc/review_teacher_remark",
        "rank": 9,
        "types": types_wrapped("bTHpr", "bTLR0", "Review Teacher Remark", review_fields, False),
        "method": "post",
        "headers": headers("bTLR1", "bTLR2", TEACHER_JWT),
        "ret_value": "api.apiconnector2.bTHpr.bTLR0",
        "publish_as": "action",
        "wrap_error": True,
        "body_params": body_params(
            [
                ("bTLR3", "p_remark_id", "00000000-0000-0000-0000-000000000001"),
                ("bTLR4", "p_action", "approve"),
                ("bTLR5", "p_final_text", ""),
            ]
        ),
        "get_headers": True,
        "initialized": True,
        "must_reinitialize": False,
        "should_reinitialize": False,
        "url_cant_be_private": True,
        "response_schema_truncated": False,
    }
    teacher_calls["bTLR0"]["body_params"]["bTLR5"]["allow_blank"] = True

    draft_fields = {}
    for name, btype, sample in [
        ("success", "boolean", True),
        ("period", "text", "2026-08"),
        ("drafted", "number", 1),
        ("low_data", "number", 0),
        ("skipped", "number", 0),
        ("failed", "number", 0),
    ]:
        draft_fields.update(field(name, btype, sample))

    teacher_calls["bTLD0"] = {
        "body": '{\n  "p_batch_id": "<p_batch_id>",\n  "p_month": "<p_month>",\n  "p_student_id": "<p_student_id>",\n  "limit": <limit>,\n  "regenerate": <regenerate>\n}',
        "name": "Draft Remarks",
        "url": f"{BASE}/functions/v1/draft-remarks",
        "rank": 10,
        "types": types_flat("bTHpr", "bTLD0", "Draft Remarks", draft_fields),
        "method": "post",
        "headers": headers("bTLD1", "bTLD2", TEACHER_JWT),
        "ret_value": "api.apiconnector2.bTHpr.bTLD0",
        "publish_as": "action",
        "wrap_error": False,
        "body_params": {
            "bTLD3": {"key": "p_batch_id", "value": G3, "private": False},
            "bTLD4": {"key": "p_month", "value": "2026-08", "private": False},
            "bTLD5": {"key": "p_student_id", "value": "", "private": False, "allow_blank": True},
            "bTLD6": {"key": "limit", "value": "30", "private": False},
            "bTLD7": {"key": "regenerate", "value": "false", "private": False},
        },
        "get_headers": False,
        "initialized": True,
        "must_reinitialize": False,
        "should_reinitialize": False,
        "url_cant_be_private": True,
        "response_schema_truncated": False,
    }

    pub_fields = {}
    for name, btype, sample in [
        ("success", "boolean", True),
        ("sent", "number", 1),
        ("skipped", "number", 0),
        ("failed", "number", 0),
        ("approved", "number", 1),
    ]:
        pub_fields.update(field(name, btype, sample))

    teacher_calls["bTLP0"] = {
        "body": '{\n  "p_batch_id": "<p_batch_id>",\n  "p_month": "<p_month>"\n}',
        "name": "Publish Remarks",
        "url": f"{BASE}/functions/v1/publish-remarks",
        "rank": 11,
        "types": types_flat("bTHpr", "bTLP0", "Publish Remarks", pub_fields),
        "method": "post",
        "headers": headers("bTLP1", "bTLP2", TEACHER_JWT),
        "ret_value": "api.apiconnector2.bTHpr.bTLP0",
        "publish_as": "action",
        "wrap_error": False,
        "body_params": body_params(
            [
                ("bTLP3", "p_batch_id", G3),
                ("bTLP4", "p_month", "2026-08"),
            ]
        ),
        "get_headers": False,
        "initialized": True,
        "must_reinitialize": False,
        "should_reinitialize": False,
        "url_cant_be_private": True,
        "response_schema_truncated": False,
    }

    tone_fields = {}
    for name, btype, sample in [
        ("language", "text", "en"),
        ("template_version", "number", 1),
        ("tone_text", "text", "Write a short parent-facing monthly progress remark."),
        ("active", "boolean", True),
    ]:
        tone_fields.update(field(name, btype, sample))

    main_calls["bTLT0"] = {
        "body": '{ "p_language": "<p_language>" }',
        "name": "Get Admin Remark Tone",
        "url": f"{BASE}/rest/v1/rpc/get_admin_remark_tone",
        "rank": 56,
        "types": types_wrapped("bTGMS0", "bTLT0", "Get Admin Remark Tone", tone_fields, True),
        "method": "post",
        "headers": headers("bTLT1", "bTLT2", admin_jwt),
        "ret_value": "api.apiconnector2.bTGMS0.bTLT0",
        "publish_as": "data",
        "wrap_error": True,
        "body_params": body_params([("bTLT3", "p_language", "en")]),
        "get_headers": True,
        "initialized": True,
        "must_reinitialize": False,
        "should_reinitialize": False,
        "url_cant_be_private": True,
        "response_schema_truncated": False,
    }

    upd_fields = {}
    for name, btype, sample in [
        ("success", "boolean", True),
        ("language", "text", "en"),
        ("template_version", "number", 2),
    ]:
        upd_fields.update(field(name, btype, sample))

    main_calls["bTLU0"] = {
        "body": '{ "p_language": "<p_language>", "p_tone_text": "<p_tone_text>" }',
        "name": "Update Admin Remark Tone",
        "url": f"{BASE}/rest/v1/rpc/update_admin_remark_tone",
        "rank": 57,
        "types": types_wrapped("bTGMS0", "bTLU0", "Update Admin Remark Tone", upd_fields, False),
        "method": "post",
        "headers": headers("bTLU1", "bTLU2", admin_jwt),
        "ret_value": "api.apiconnector2.bTGMS0.bTLU0",
        "publish_as": "action",
        "wrap_error": True,
        "body_params": body_params(
            [
                ("bTLU3", "p_language", "en"),
                ("bTLU4", "p_tone_text", "Write a short parent-facing monthly progress remark. Be supportive and specific."),
            ]
        ),
        "get_headers": True,
        "initialized": True,
        "must_reinitialize": False,
        "should_reinitialize": False,
        "url_cant_be_private": True,
        "response_schema_truncated": False,
    }

    page = data["pages"]["bTGMr0"]
    page["custom_states"]["text_9"] = {
        "display": "remark_month",
        "value": "text",
        "rank": 15,
        "default_val": "2026-08",
        "make_static": True,
    }
    page["custom_states"]["number_3"] = {
        "display": "remark_bust",
        "value": "number",
        "rank": 16,
        "default_val": 1,
        "make_static": True,
    }

    att_popup = copy.deepcopy(page["elements"]["bTINZ"])
    popup_ids: set[str] = set()
    collect_bt_ids(att_popup, popup_ids)
    keep = {
        PAGE_ID,
        AUTH_EL,
        "bTHpr",
        "bTGMS0",
        "bTHps",
        "bTHqE",
        "bTLQ0",
        "bTLR0",
        "bTLD0",
        "bTLP0",
        "bTGNC0",
        "bTGND0",
    }
    mapping = {}
    for old in sorted(popup_ids, key=len, reverse=True):
        if old in keep:
            continue
        mapping[old] = nid()
    remarks_popup = remap_ids(att_popup, mapping)
    remarks_popup["name"] = "Popup remarks-review"
    popup_el_id = remarks_popup["id"]
    popup_dict_key = nid()
    remarks_popup_json = json.dumps(remarks_popup)
    remarks_popup_json = remarks_popup_json.replace(
        "apiconnector2.bTHpr.bTHqE", "apiconnector2.bTHpr.bTLQ0"
    )
    remarks_popup_json = remarks_popup_json.replace("Get Attendance Sheet", "Get Teacher Remark Queue")
    remarks_popup = json.loads(remarks_popup_json)

    def walk_set_text(obj, old_caption: str, new_caption: str):
        if isinstance(obj, dict):
            text = obj.get("text")
            if isinstance(text, dict) and text.get("entries", {}).get("0") == old_caption:
                text["entries"]["0"] = new_caption
            for v in obj.values():
                walk_set_text(v, old_caption, new_caption)
        elif isinstance(obj, list):
            for v in obj:
                walk_set_text(v, old_caption, new_caption)

    walk_set_text(remarks_popup, "P", "Approve")
    walk_set_text(remarks_popup, "A", "Reject")
    walk_set_text(remarks_popup, "L", "Regen")
    walk_set_text(remarks_popup, "Leave", "Save")
    walk_set_text(remarks_popup, "save", "Publish")
    walk_set_text(remarks_popup, "close", "Close")

    def find_buttons(obj, acc):
        if isinstance(obj, dict):
            if obj.get("type") == "Button":
                label = ((obj.get("properties") or {}).get("text") or {}).get("entries", {}).get("0")
                acc.append((obj.get("id"), label, obj))
            for v in obj.values():
                find_buttons(v, acc)
        elif isinstance(obj, list):
            for v in obj:
                find_buttons(v, acc)

    buttons = []
    find_buttons(remarks_popup, buttons)
    btn_ids = {label: i for i, label, _ in buttons if label}

    def patch_rg(obj):
        if isinstance(obj, dict):
            ds = obj.get("properties", {}).get("data_source") if obj.get("type") == "RepeatingGroup" else None
            if ds and isinstance(ds, dict):
                props = ds.setdefault("properties", {})
                props["provider"] = "apiconnector2.bTHpr.bTLQ0"
                props["url_params_limit"] = text_expr("500")
                props["body_params_p_batch_id"] = text_expr(page_state("custom.text_1"))
                props["body_params_p_month"] = text_expr(page_state("custom.text_9"))
                props["body_params_p_status"] = text_expr("all")
                props["body_params_p_bust"] = text_expr(page_state("custom.number_3"))
                props["headers_Content-Type"] = text_expr("application/json")
                props["headers_Authorization"] = auth_header_expr()
                obj["properties"]["group_type"] = "api.apiconnector2.bTHpr.bTLQ0.body"
            for v in obj.values():
                patch_rg(v)
        elif isinstance(obj, list):
            for v in obj:
                patch_rg(v)

    patch_rg(remarks_popup)

    def patch_student_name_to_include_status(obj):
        if isinstance(obj, dict):
            text = (obj.get("properties") or {}).get("text")
            if isinstance(text, dict):
                entries = text.get("entries") or {}
                if any(
                    isinstance(v, dict) and v.get("next", {}).get("name") == "_api_c2_student_name"
                    for v in entries.values()
                ):
                    text["entries"] = {
                        "0": "",
                        "1": parent_field("_api_c2_student_name"),
                        "2": "  ·  ",
                        "3": parent_field("_api_c2_status"),
                        "4": "",
                    }
            for v in obj.values():
                patch_student_name_to_include_status(v)
        elif isinstance(obj, list):
            for v in obj:
                patch_student_name_to_include_status(v)

    patch_student_name_to_include_status(remarks_popup)

    input_id = nid()
    input_key = nid()

    def add_input_to_cell(obj) -> bool:
        if isinstance(obj, list):
            return any(add_input_to_cell(v) for v in obj)
        if not isinstance(obj, dict):
            return False
        if obj.get("type") == "RepeatingGroup":
            elements = obj.get("elements") or {}
            for cell in elements.values():
                if not isinstance(cell, dict):
                    continue
                cell_els = cell.setdefault("elements", {})
                cell_els[input_key] = {
                    "properties": {
                        "placeholder": {"entries": {"0": "Edit remark before approve/save"}, "type": "TextExpression"},
                        "initial_content": text_expr(parent_field("_api_c2_final_text")),
                        "height": 72,
                        "width": 280,
                        "zindex": 6,
                        "order": 10,
                        "fit_width": True,
                        "fit_height": True,
                        "single_width": False,
                        "min_width_css": "180px",
                        "multiline": True,
                    },
                    "type": "Input",
                    "id": input_id,
                    "name": "Input remark-edit",
                }
                return True
        return any(add_input_to_cell(v) for v in obj.values())

    add_input_to_cell(remarks_popup)
    page["elements"][popup_dict_key] = remarks_popup

    rg_cell = page["elements"]["bTHjY"]["elements"]["bTGsk"]["elements"]["bTHrp"]["elements"]["bTHsk"]["elements"]["bTHsr"]
    remarks_btn_key = nid()
    remarks_btn_id = nid()
    assess_btn = copy.deepcopy(rg_cell["elements"]["bTINI"])
    assess_btn["id"] = remarks_btn_id
    assess_btn["name"] = "Button remarks"
    assess_btn["properties"]["text"] = {"entries": {"0": "Remarks"}, "type": "TextExpression"}
    assess_btn["properties"]["order"] = 8
    rg_cell["elements"][remarks_btn_key] = assess_btn

    def increment_remark_bust(action_id: str) -> dict:
        return {
            "properties": {
                "value": {
                    "next": {
                        "properties": {"component_to_extract": "UNIX"},
                        "type": "Message",
                        "name": "extract_from_date",
                        "is_slidable": True,
                    },
                    "properties": {"name": "Current Date/Time"},
                    "type": "PageData",
                    "is_slidable": False,
                },
                "element_id": PAGE_ID,
                "custom_state": "custom.number_3",
            },
            "type": "SetCustomState",
            "id": action_id,
        }

    def set_batch_then_show() -> dict:
        return {
            "properties": {"element_id": remarks_btn_id},
            "type": "ButtonClicked",
            "id": nid(),
            "actions": {
                "0": {
                    "properties": {
                        "value": parent_field("_api_c2_batch_id"),
                        "element_id": PAGE_ID,
                        "custom_state": "custom.text_1",
                        "custom_states_values": {
                            "0": {
                                "value": parent_field("_api_c2_batch_name"),
                                "custom_state": "custom.text_2",
                            }
                        },
                    },
                    "type": "SetCustomState",
                    "id": nid(),
                },
                "1": increment_remark_bust(nid()),
                "2": {
                    "properties": {"element_id": popup_el_id},
                    "type": "ShowElement",
                    "id": nid(),
                },
            },
        }

    workflows = page["workflows"]

    def add_wf(wf: dict):
        workflows[nid()] = wf

    add_wf(set_batch_then_show())

    close_id = btn_ids.get("Close")
    if close_id:
        add_wf(
            {
                "properties": {"element_id": close_id},
                "type": "ButtonClicked",
                "id": nid(),
                "actions": {
                    "0": {
                        "properties": {"element_id": popup_el_id},
                        "type": "HideElement",
                        "id": nid(),
                    }
                },
            }
        )

    def review_wf(button_id: str, action: str, include_input: bool) -> dict:
        extra = {
            "body_params_p_remark_id": text_expr(parent_field("_api_c2_remark_id")),
            "body_params_p_action": text_expr(action),
        }
        if include_input:
            extra["body_params_p_final_text"] = text_expr(
                {
                    "next": {"type": "Message", "name": "get_data", "is_slidable": False},
                    "properties": {"element_id": input_id},
                    "type": "GetElement",
                    "is_slidable": False,
                }
            )
        else:
            extra["body_params_p_final_text"] = text_expr("")
        return {
            "properties": {"element_id": button_id},
            "type": "ButtonClicked",
            "id": nid(),
            "actions": {
                "0": api_call_action("apiconnector2-bTHpr.bTLR0", nid(), extra),
                "1": increment_remark_bust(nid()),
            },
        }

    if btn_ids.get("Approve"):
        add_wf(review_wf(btn_ids["Approve"], "approve", True))
    if btn_ids.get("Reject"):
        add_wf(review_wf(btn_ids["Reject"], "reject", False))
    if btn_ids.get("Save"):
        add_wf(review_wf(btn_ids["Save"], "save_edit", True))

    regen_id = btn_ids.get("Regen")
    if regen_id:
        add_wf(
            {
                "properties": {"element_id": regen_id},
                "type": "ButtonClicked",
                "id": nid(),
                "actions": {
                    "0": api_call_action(
                        "apiconnector2-bTHpr.bTLD0",
                        nid(),
                        {
                            "body_params_p_batch_id": text_expr(page_state("custom.text_1")),
                            "body_params_p_month": text_expr(page_state("custom.text_9")),
                            "body_params_p_student_id": text_expr(parent_field("_api_c2_student_id")),
                            "body_params_limit": text_expr("1"),
                            "body_params_regenerate": text_expr("true"),
                        },
                    ),
                    "1": increment_remark_bust(nid()),
                },
            }
        )

    publish_id = btn_ids.get("Publish")
    if publish_id:
        add_wf(
            {
                "properties": {"element_id": publish_id},
                "type": "ButtonClicked",
                "id": nid(),
                "actions": {
                    "0": api_call_action(
                        "apiconnector2-bTHpr.bTLP0",
                        nid(),
                        {
                            "body_params_p_batch_id": text_expr(page_state("custom.text_1")),
                            "body_params_p_month": text_expr(page_state("custom.text_9")),
                        },
                    )
                },
            }
        )

    # Draft all: add a header button next to Publish by also binding unused "Attendance" header? 
    # Use page header logout group to add Draft Remarks for selected batch.
    header = page["elements"]["bTHjY"]["elements"]["bTILi"]
    draft_key = nid()
    draft_id = nid()
    header["elements"][draft_key] = {
        "properties": {
            "text": {"entries": {"0": "Draft remarks"}, "type": "TextExpression"},
            "height": 44,
            "width": 160,
            "zindex": 5,
            "order": 4,
            "fit_width": True,
            "fit_height": True,
            "bgcolor": "var(--color_primary_default)",
            "font_color": "var(--color_primary_contrast_default)",
        },
        "type": "Button",
        "id": draft_id,
        "name": "Button draft-remarks",
    }
    add_wf(
        {
            "properties": {"element_id": draft_id},
            "type": "ButtonClicked",
            "id": nid(),
            "actions": {
                "0": api_call_action(
                    "apiconnector2-bTHpr.bTLD0",
                    nid(),
                    {
                        "body_params_p_batch_id": text_expr(page_state("custom.text_1")),
                        "body_params_p_month": text_expr(page_state("custom.text_9")),
                        "body_params_p_student_id": text_expr(""),
                        "body_params_limit": text_expr("30"),
                        "body_params_regenerate": text_expr("false"),
                    },
                ),
                "1": increment_remark_bust(nid()),
            },
        }
    )

    # Pageload: also initialize remark_month / remark_bust
    pageload = page["workflows"]["bTGSy"]
    actions = pageload["actions"]
    next_i = str(max(int(k) for k in actions) + 1)
    actions[next_i] = {
        "properties": {
            "value": "2026-08",
            "element_id": PAGE_ID,
            "custom_state": "custom.text_9",
            "custom_states_values": {
                "0": {"value": 1, "custom_state": "custom.number_3"}
            },
        },
        "type": "SetCustomState",
        "id": nid(),
    }

    DST.write_text(json.dumps(data, separators=(",", ":")))
    print("wrote", DST, "bytes", DST.stat().st_size)
    print("popup_el_id", popup_el_id)
    print("remarks_btn_id", remarks_btn_id)
    print("buttons", btn_ids)


if __name__ == "__main__":
    main()
