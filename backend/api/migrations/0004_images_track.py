from django.db import migrations

IMAGE_DURATION = 8.0
GAP = 1.0


def _has_image(node):
    if node.get("type") == "image":
        return True
    return any(_has_image(c) for c in node.get("content", []) or [])


def convert_images(apps, schema_editor):
    Block = apps.get_model("api", "Block")
    Track = apps.get_model("api", "Track")
    Script = apps.get_model("api", "Script")

    from api.markdown import tiptap_to_markdown, word_count

    for script in Script.objects.all():
        images_track, _ = Track.objects.get_or_create(
            script=script,
            kind="images",
            defaults={"name": "Images", "order": 90},
        )
        vo_blocks = list(
            Block.objects.filter(track__script=script, track__is_script_track=True).order_by(
                "start_seconds"
            )
        )
        for vo in vo_blocks:
            content = vo.content or {}
            nodes = content.get("content", []) or []
            if not any(_has_image(n) for n in nodes):
                continue
            kept = []
            cursor = vo.start_seconds
            for node in nodes:
                if node.get("type") == "paragraph" and _has_image(node):
                    images = [
                        c for c in node.get("content", []) if c.get("type") == "image"
                    ]
                    texts = [
                        c for c in node.get("content", []) if c.get("type") != "image"
                    ]
                    for img in images:
                        Block.objects.create(
                            track=images_track,
                            start_seconds=cursor,
                            duration_seconds=IMAGE_DURATION,
                            anchor_block_id=vo.id,
                            content={
                                "type": "doc",
                                "content": [
                                    {"type": "paragraph", "content": [img]}
                                ],
                            },
                        )
                        cursor += IMAGE_DURATION + GAP
                    if texts:
                        kept.append({"type": "paragraph", "content": texts})
                else:
                    kept.append(node)
            vo.content = {"type": "doc", "content": kept}
            vo.word_count = word_count(vo.content)
            vo.content_markdown = tiptap_to_markdown(vo.content)
            seconds = (
                min(vo.word_count / (vo.wpm_override or script.wpm_override or script.project.default_wpm) * 60.0, 600.0)
                if vo.word_count > 0
                else 0.0
            )
            vo.duration_seconds = seconds
            vo.save()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0003_block_clip_kind_block_editor_note_and_more"),
    ]

    operations = [
        migrations.RunPython(convert_images, noop),
    ]
