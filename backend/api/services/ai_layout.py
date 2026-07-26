import json
import os
import urllib.request

from api.markdown import tiptap_to_plaintext
from api.models import Block

SYSTEM_PROMPT = """You are a video-editing assistant for a faceless-documentary script tool.
You receive the blocks of a script as JSON (voiceover blocks with text, plus b-roll/resource
blocks with clip metadata). Return ONLY a JSON object of the form:
{"placements": [{"block_id": <int>, "start_seconds": <float>, "anchor_block_id": <int|null>}]}
Suggest tighter, better-aligned start times for non-voiceover blocks relative to the
voiceover they belong to, and anchor them where possible. Do not modify voiceover blocks."""


def get_api_config():
    if os.environ.get("DEEPSEEK_API_KEY"):
        return {
            "url": "https://api.deepseek.com/chat/completions",
            "key": os.environ["DEEPSEEK_API_KEY"],
            "model": os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-pro"),
            "provider": "openai",
        }

    if os.environ.get("OPENAI_API_KEY"):
        return {
            "url": "https://api.openai.com/v1/chat/completions",
            "key": os.environ["OPENAI_API_KEY"],
            "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            "provider": "openai",
        }
    if os.environ.get("ANTHROPIC_API_KEY"):
        return {
            "url": "https://api.anthropic.com/v1/messages",
            "key": os.environ["ANTHROPIC_API_KEY"],
            "model": os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
            "provider": "anthropic",
        }
    return None



def is_configured():
    return get_api_config() is not None


def _block_summary(block):
    return {
        "id": block.id,
        "track_kind": block.track.kind,
        "is_script_track": block.track.is_script_track,
        "title": block.title,
        "start_seconds": block.start_seconds,
        "duration_seconds": block.duration_seconds,
        "text": tiptap_to_plaintext(block.content)[:500],
        "clip_kind": block.clip_kind,
        "source_url": block.source_url,
        "anchor_block_id": block.anchor_block_id,
    }


def suggest_layout(script):
    config = get_api_config()
    if config is None:
        return None

    blocks = Block.objects.filter(track__script=script).select_related("track")
    payload = [_block_summary(b) for b in blocks]

    if config["provider"] == "openai":
        body = {
            "model": config["model"],
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(payload)},
            ],
            "response_format": {"type": "json_object"},
        }
        headers = {"Authorization": f"Bearer {config['key']}"}
    else:
        body = {
            "model": config["model"],
            "max_tokens": 4096,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": json.dumps(payload)}],
        }
        headers = {"x-api-key": config["key"], "anthropic-version": "2023-06-01"}

    req = urllib.request.Request(
        config["url"],
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        data = json.loads(res.read())

    if config["provider"] == "openai":
        text = data["choices"][0]["message"]["content"]
    else:
        text = "".join(part["text"] for part in data["content"] if part["type"] == "text")
    return json.loads(text)


def apply_layout(script, layout):
    applied = 0
    for placement in layout.get("placements", []):
        try:
            block = Block.objects.get(pk=placement["block_id"], track__script=script)
        except (Block.DoesNotExist, KeyError, TypeError):
            continue
        if block.track.is_script_track:
            continue
        if "start_seconds" in placement:
            block.start_seconds = max(0.0, float(placement["start_seconds"]))
        anchor_id = placement.get("anchor_block_id")
        if anchor_id:
            try:
                anchor = Block.objects.get(pk=anchor_id, track__script=script)
                if anchor.track.is_script_track:
                    block.anchor_block = anchor
            except Block.DoesNotExist:
                pass
        block.version += 1
        block.save()
        applied += 1
    return applied
