"""Token-bounded chunks with original character offsets; no model loading."""
import re


def windows(text, tokenizer, limit=768, overlap=64, prefix=""):
    if not text.strip():
        return []
    if limit < 16 or overlap < 0 or overlap >= limit // 2:
        raise ValueError("invalid chunk limit/overlap")
    prefix_ids = tokenizer.encode(prefix, add_special_tokens=False)[: min(128, limit // 4)]
    prefix = tokenizer.decode(prefix_ids, skip_special_tokens=True) if prefix_ids else ""
    budget = limit - len(prefix_ids) - 8
    offsets = tokenizer(text, add_special_tokens=False, return_offsets_mapping=True)["offset_mapping"]
    result = []
    start = 0
    while start < len(offsets):
        end = min(start + budget, len(offsets))
        lo, hi = offsets[start][0], offsets[end - 1][1]
        result.append({"text": (prefix + "\n" if prefix else "") + text[lo:hi], "start": lo, "end": hi})
        if end == len(offsets):
            break
        start = max(start + 1, end - overlap)
    return result


def prepare_chunks(kind, payload, tokenizer, limit=768, overlap=64):
    if kind == "paper":
        title = payload["metadata"]["title"]
        body = payload["note"]
        headings = list(re.finditer(r"(?m)^#{1,6}\s+.+$", body))
        boundaries = sorted(set([0] + [m.start() for m in headings] + [len(body)]))
        chunks = []
        for left, right in zip(boundaries, boundaries[1:]):
            section = body[left:right]
            heading = section.splitlines()[0] if section.startswith("#") else ""
            # Preserve a whole section if it fits; otherwise split on paragraphs first.
            parts = [(0, section)]
            if len(tokenizer.encode(section, add_special_tokens=False)) > limit - 136:
                parts = [(m.start(), m.group()) for m in re.finditer(r"\S[\s\S]*?(?=\n\s*\n|\Z)", section)]
            for offset, part in parts:
                for chunk in windows(part, tokenizer, limit, overlap, title + "\n" + heading):
                    chunks.append({"text": chunk["text"], "location": {"field": "note", "heading": heading, "start": left+offset+chunk["start"], "end": left+offset+chunk["end"]}})
        return chunks
    prefix = "\n".join(payload[field] for field in ["task", "applicability"] if field in payload)
    body = payload["strategy"] + "\n\n" + payload["executionSummary"][:1200]
    whole = (prefix + "\n" if prefix else "") + body
    if len(tokenizer.encode(whole, add_special_tokens=False)) <= limit - 2:
        return [{"text": whole, "location": {"field": "experience", "part": 0}}]
    # Also index long task/conditions separately, so truncating the repeated prefix loses no field.
    chunks = []
    for field in ["task", "applicability", "strategy"]:
        for match in re.finditer(r"\S[\s\S]*?(?=\n\s*\n|\Z)", payload.get(field, "")):
            for chunk in windows(match.group(), tokenizer, limit, overlap, prefix):
                chunks.append({"text": chunk["text"], "location": {"field": field, "start": match.start()+chunk["start"], "end": match.start()+chunk["end"]}})
    return chunks
