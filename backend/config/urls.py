from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter
from rest_framework.authtoken.views import obtain_auth_token

from api.views import (
    BlockViewSet,
    MediaUploadView,
    ProjectViewSet,
    ResourceViewSet,
    ScriptViewSet,
    TagViewSet,
    TrackViewSet,
)

router = DefaultRouter()
router.register("projects", ProjectViewSet)
router.register("scripts", ScriptViewSet)
router.register("tracks", TrackViewSet)
router.register("blocks", BlockViewSet)
router.register("tags", TagViewSet)
router.register("resources", ResourceViewSet)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(router.urls)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("api/token/", obtain_auth_token),
    path("api/media/", MediaUploadView.as_view()),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
