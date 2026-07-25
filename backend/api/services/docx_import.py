import re

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from docx import Document

from api.markdown import tiptap_to_markdown, word_count
from api.models import Block, Project, Script, Track

CLIP_PAREN_RE = re.compile(
    r"^\((?P<kind>Muted Background Clip|Full Clip|Clip)\s*@\s*"
    r"(?P<times>[0-9:,\s-]+?)\s+(?P<url>\S+)\)$",
    re.IGNORECASE,
)
FULL_CLIP_RE = re.compile(r"^\(Full Clip\s+(?P<url>\S+)\)$", re.IGNORECASE)
URL_PAREN_RE = re.compile(r"^\((?P<url>https?://\S+)\)$")
ANY_URL_RE = re.compile(r"https?://[^\s)]+")
QUOTE_RE = re.compile(r'^[“"](?P<text>.+)[”"]$')
TIME_RE = re.compile(r"(\d+):(\d+)(?::(\d+))?")

KIND_MAP = {
    "muted background clip": Block.ClipKind.MUTED,
    "clip": Block.ClipKind.CLIP,
    "full clip": Block.ClipKind.FULL,
}

GAP_BETWEEN_VO = 2.0
GAP_BETWEEN_CLIPS = 1.0
DEFAULT_RESOURCE_DURATION = 5.0


def parse_ts(ts):
    m = TIME_RE.search(ts.strip())
    if not m:
        return None
    h_or_m = int(m.group(1))
    rest = int(m.group(2))
    if m.group(3) is not None:
        return h_or_m * 3600 + rest * 60 + int(m.group(3))
    return h_or_m * 60 + rest


def parse_in_out(times_str):
    parts = [p.strip() for p in times_str.split("-")]
    if len(parts) == 2:
        return parse_ts(parts[0]), parse_ts(parts[1])
    if len(parts) == 1:
        return parse_ts(parts[0]), None
    return None, None


def _is_url(text):
    return text.startswith("http://") or text.startswith("https://")


def classify_paragraph(text):
    t = text.strip()
    if not t:
        return ("blank", None)
    m = CLIP_PAREN_RE.match(t)
    if m:
        in_s, out_s = parse_in_out(m.group("times"))
        return (
            "clip",
            {
                "kind": KIND_MAP[m.group("kind").lower()],
                "url": m.group("url"),
                "in": in_s,
                "out": out_s,
            },
        )
    m = FULL_CLIP_RE.match(t)
    if m:
        return ("clip", {"kind": Block.ClipKind.FULL, "url": m.group("url"), "in": None, "out": None})
    m = URL_PAREN_RE.match(t)
    if m:
        return ("link", {"url": m.group("url")})
    m = QUOTE_RE.match(t)
    if m and not _is_url(t):
        return ("quote", {"text": m.group("text")})
    if t.startswith("(") and t.endswith(")") and not ANY_URL_RE.search(t):
        return ("editor_note", {"text": t[1:-1]})
    if t.startswith("(") and t.endswith(")") and ANY_URL_RE.search(t):
        url = ANY_URL_RE.search(t).group(0)
        note = t[1:-1].replace(url, "").strip()
        return ("link", {"url": url, "note": note})
    return ("prose", {"text": t})


def tiptap_doc(paragraphs):
    return {"type": "doc", "content": paragraphs}


def text_para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def quote_para(text):
    return {
        "type": "blockquote",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


def link_para(url, note=""):
    content = [
        {
            "type": "text",
            "text": url,
            "marks": [{"type": "link", "attrs": {"href": url}}],
        }
    ]
    if note:
        content.insert(0, {"type": "text", "text": f"{note} "})
    return {"type": "paragraph", "content": content}


def image_para(src):
    return {"type": "paragraph", "content": [{"type": "image", "attrs": {"src": src}}]}


def create_default_tracks(script):
    for order, (kind, name) in enumerate(Track.KIND_DEFAULT_NAMES.items()):
        Track.objects.create(
            script=script,
            kind=kind,
            name=name,
            order=order,
            is_script_track=(kind == "voiceover"),
        )


def import_docx_file(source, project_name=None, title=None):
    doc = Document(source)

    project, _ = Project.objects.get_or_create(name=project_name or "My Channel")
    if not title:
        title = getattr(source, "name", "Imported Script")
        title = title.split("/")[-1].rsplit(".", 1)[0]
    script = Script.objects.create(project=project, title=title)
    create_default_tracks(script)
    tracks = {t.kind: t for t in script.tracks.all()}
    vo_track = tracks["voiceover"]
    broll_track = tracks["broll"]
    resource_track = tracks["resources"]
    images_track = tracks["images"]

    image_map = {}
    for rel_id, rel in doc.part.rels.items():
        if "image" in rel.reltype:
            try:
                blob = rel.target_part.blob
                fname = str(rel.target_part.partname).rsplit("/", 1)[-1]
                saved = default_storage.save(
                    f"uploads/{script.pk}_{fname}", ContentFile(blob)
                )
                image_map[rel_id] = f"/media/{saved}"
            except Exception:
                continue

    vo_cursor = 0.0
    current_vo = None
    clip_cursor = 0.0
    stats = {"vo": 0, "clips": 0, "links": 0, "quotes": 0, "images": 0}

    def flush_vo():
        nonlocal current_vo, vo_cursor, clip_cursor
        if current_vo is not None:
            current_vo.word_count = word_count(current_vo.content)
            current_vo.content_markdown = tiptap_to_markdown(current_vo.content)
            current_vo.recompute_auto_duration()
            current_vo.save()
            vo_cursor = current_vo.start_seconds + current_vo.duration_seconds + GAP_BETWEEN_VO
            clip_cursor = vo_cursor
            stats["vo"] += 1
            current_vo = None

    def ensure_vo():
        nonlocal current_vo
        if current_vo is None:
            current_vo = Block.objects.create(
                track=vo_track, start_seconds=vo_cursor, content=tiptap_doc([])
            )
        return current_vo

    def append_to_vo(paragraph):
        vo = ensure_vo()
        vo.content["content"].append(paragraph)
        vo.save()

    def next_clip_start(duration):
        nonlocal clip_cursor
        anchor_start = current_vo.start_seconds if current_vo else vo_cursor
        start = max(anchor_start, clip_cursor)
        clip_cursor = start + max(duration, 1.0) + GAP_BETWEEN_CLIPS
        return start

    for para in doc.paragraphs:
        style = (para.style.name or "").lower() if para.style else ""
        text = para.text.strip()

        for run in para.runs:
            for blip in run._element.findall(
                ".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip"
            ):
                rel_id = blip.get(
                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"
                )
                if rel_id in image_map:
                    src = image_map[rel_id]
                    Block.objects.create(
                        track=images_track,
                        start_seconds=next_clip_start(8.0),
                        duration_seconds=8.0,
                        anchor_block=current_vo,
                        content=tiptap_doc([image_para(src)]),
                        source_url=src if src.startswith("http") else "",
                    )
                    stats["images"] += 1

        kind, payload = classify_paragraph(text)
        if kind == "blank":
            continue

        if style.startswith("heading") or style in ("title",):
            flush_vo()
            vo = ensure_vo()
            vo.title = text
            vo.save()
            continue

        if kind == "prose":
            append_to_vo(text_para(payload["text"]))
            if (
                current_vo is not None
                and len(current_vo.content["content"]) >= 6
                and text.endswith((".", "!", "?", "…"))
            ):
                flush_vo()
        elif kind == "quote":
            append_to_vo(quote_para(payload["text"]))
            stats["quotes"] += 1
        elif kind == "clip":
            duration = 0.0
            if payload.get("in") is not None and payload.get("out") is not None:
                duration = max(1.0, payload["out"] - payload["in"])
            Block.objects.create(
                track=broll_track,
                start_seconds=next_clip_start(duration or DEFAULT_RESOURCE_DURATION),
                duration_seconds=duration,
                clip_kind=payload["kind"],
                source_url=payload["url"],
                source_in_seconds=payload.get("in"),
                source_out_seconds=payload.get("out"),
                anchor_block=current_vo,
            )
            stats["clips"] += 1
        elif kind == "link":
            Block.objects.create(
                track=resource_track,
                start_seconds=next_clip_start(DEFAULT_RESOURCE_DURATION),
                duration_seconds=DEFAULT_RESOURCE_DURATION,
                source_url=payload["url"],
                editor_note=payload.get("note", ""),
                anchor_block=current_vo,
                content=tiptap_doc([link_para(payload["url"], payload.get("note", ""))]),
            )
            stats["links"] += 1
        elif kind == "editor_note":
            vo = current_vo
            if vo is not None:
                note = payload["text"]
                vo.editor_note = (vo.editor_note + "\n" + note).strip() if vo.editor_note else note
                vo.save()

    flush_vo()
    return script, stats
