import json
import os
import urllib.request
from typing import Generator, Dict, Any, List

from api.markdown import tiptap_to_plaintext
from api.models import Block, Script
from api.services.ai_layout import get_api_config

SYSTEM_PROMPT = """You are a Script Editing Copilot for YouTube documentary creators.
You have full awareness of the complete documentary script, including all voiceover sections, B-roll notes, resource clips, word counts, and sequence pacing.

You can answer general macro-level questions about the script (e.g. overall flow, hook quality, tone, structural pacing, section summaries) OR help refine specific sections/blocks.

When the user asks for text revisions, re-timing, or visual notes for a block, provide your commentary AND include a structured proposal block in your response.

Structure your response in markdown text. If you suggest changes to a block, embed a JSON code block with language `json:proposal` like this:

```json:proposal
{
  "block_id": 123,
  "action": "update_content",
  "original_text": "text before",
  "proposed_text": "text after",
  "reason": "reason for change"
}
```

Keep your advice concise, sharp, and tailored for fast-paced, high-retention YouTube documentaries."""



def build_chat_context(script: Script, target_block_id: int | None = None) -> List[Dict[str, Any]]:
    blocks = Block.objects.filter(track__script=script).select_related("track").order_by("start_seconds", "id")
    context_blocks = []
    for b in blocks:
        text = tiptap_to_plaintext(b.content) if b.content else b.content_markdown
        context_blocks.append({
            "id": b.id,
            "track_name": b.track.name,
            "track_kind": b.track.kind,
            "is_script_track": b.track.is_script_track,
            "title": b.title,
            "start_seconds": b.start_seconds,
            "duration_seconds": b.duration_seconds,
            "word_count": b.word_count,
            "text": text[:1000] if text else "",
            "editor_note": b.editor_note,
            "is_target": (b.id == target_block_id),
        })
    return context_blocks


def stream_chat_response(
    script: Script,
    messages: List[Dict[str, str]],
    target_block_id: int | None = None
) -> Generator[str, None, None]:
    config = get_api_config()
    context_blocks = build_chat_context(script, target_block_id)
    
    system_message = (
        f"{SYSTEM_PROMPT}\n\n"
        f"CURRENT SCRIPT CONTEXT ({script.title}):\n"
        f"{json.dumps(context_blocks, indent=2)}"
    )

    if config is None:
        target_text = "Sample section text"
        target_id = target_block_id or (context_blocks[0]["id"] if context_blocks else 1)
        if target_block_id:
            try:
                target_block = Block.objects.get(pk=target_block_id, track__script=script)
                target_text = tiptap_to_plaintext(target_block.content) if target_block.content else (target_block.content_markdown or target_block.title or "Sample text")
            except Block.DoesNotExist:
                pass

        mock_text = target_text[:120].replace('"', '\\"') if target_text else "Section content"
        mock_response = (
            "I'm ready to help you edit your script! (Note: Set `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` on the backend for live LLM completions).\n\n"

            f"Here is a suggested revision for block #{target_id}:\n\n"
            "```json:proposal\n"
            "{\n"
            f'  "block_id": {target_id},\n'
            '  "action": "update_content",\n'
            f'  "original_text": "{mock_text}",\n'
            f'  "proposed_text": "{mock_text} — revised for maximum hook impact and flow.",\n'
            '  "reason": "Tightens pacing and improves retention for YouTube viewers."\n'
            "}\n"
            "```"
        )
        
        words = mock_response.split(" ")
        for i in range(0, len(words), 3):
            chunk = " ".join(words[i:i+3]) + " "
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # Real LLM API streaming call
    formatted_messages = [{"role": "system", "content": system_message}]
    for m in messages:
        formatted_messages.append({"role": m["role"], "content": m["content"]})

    if config["provider"] == "openai":
        body = {
            "model": config["model"],
            "messages": formatted_messages,
            "stream": True,
        }
        headers = {
            "Authorization": f"Bearer {config['key']}",
            "Content-Type": "application/json",
        }
        req = urllib.request.Request(
            config["url"],
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                for line in res:
                    line_str = line.decode("utf-8").strip()
                    if line_str.startswith("data: "):
                        data_str = line_str[6:]
                        if data_str == "[DONE]":
                            yield "data: [DONE]\n\n"
                            break
                        try:
                            parsed = json.loads(data_str)
                            delta = parsed["choices"][0]["delta"].get("content", "")
                            if delta:
                                yield f"data: {json.dumps({'text': delta})}\n\n"
                        except Exception:
                            continue
        except Exception as e:
            yield f"data: {json.dumps({'text': f'API Error: {str(e)}'})}\n\n"
            yield "data: [DONE]\n\n"
    else:
        # Anthropic streaming
        body = {
            "model": config["model"],
            "max_tokens": 4096,
            "system": system_message,
            "messages": [m for m in messages if m["role"] != "system"],
            "stream": True,
        }
        headers = {
            "x-api-key": config["key"],
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        req = urllib.request.Request(
            config["url"],
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                for line in res:
                    line_str = line.decode("utf-8").strip()
                    if line_str.startswith("data: "):
                        data_str = line_str[6:]
                        try:
                            parsed = json.loads(data_str)
                            if parsed.get("type") == "content_block_delta":
                                text = parsed.get("delta", {}).get("text", "")
                                if text:
                                    yield f"data: {json.dumps({'text': text})}\n\n"
                        except Exception:
                            continue
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'text': f'API Error: {str(e)}'})}\n\n"
            yield "data: [DONE]\n\n"
