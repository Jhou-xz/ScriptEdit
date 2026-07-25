def _node_text(node):
    parts = []
    if node.get("type") == "text":
        parts.append(node.get("text", ""))
    for child in node.get("content", []) or []:
        parts.append(_node_text(child))
    return "".join(parts)


def tiptap_to_plaintext(doc):
    if not isinstance(doc, dict):
        return ""
    lines = []
    for node in doc.get("content", []) or []:
        text = _node_text(node).strip()
        if text:
            lines.append(text)
    return "\n".join(lines)


def tiptap_to_markdown(doc):
    if not isinstance(doc, dict):
        return ""
    out = []
    for node in doc.get("content", []) or []:
        ntype = node.get("type")
        text = _node_text(node).strip()
        if not text:
            continue
        if ntype == "heading":
            level = node.get("attrs", {}).get("level", 2)
            out.append("#" * min(max(level, 1), 6) + " " + text)
        elif ntype in ("bulletList", "orderedList"):
            for i, item in enumerate(node.get("content", []) or [], 1):
                item_text = _node_text(item).strip()
                if item_text:
                    prefix = "-" if ntype == "bulletList" else f"{i}."
                    out.append(f"{prefix} {item_text}")
        elif ntype == "blockquote":
            out.append("> " + text)
        else:
            out.append(text)
    return "\n\n".join(out)


def word_count(doc):
    text = tiptap_to_plaintext(doc)
    return len(text.split()) if text else 0
