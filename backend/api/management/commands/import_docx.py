from django.core.management.base import BaseCommand, CommandError

from api.services.docx_import import import_docx_file


class Command(BaseCommand):
    help = "Import a .docx script (faceless-documentary format) into a project."

    def add_arguments(self, parser):
        parser.add_argument("path", type=str)
        parser.add_argument("--project", type=str, default=None)
        parser.add_argument("--title", type=str, default=None)

    def handle(self, *args, **options):
        try:
            script, stats = import_docx_file(
                options["path"],
                project_name=options["project"],
                title=options["title"],
            )
        except Exception as e:
            raise CommandError(f"Could not import docx: {e}")

        self.stdout.write(
            self.style.SUCCESS(
                f"Imported '{script.title}' (script id {script.pk}): "
                f"{stats['vo']} VO blocks, {stats['clips']} clips, "
                f"{stats['links']} links, {stats['quotes']} quotes, {stats['images']} images"
            )
        )
