from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from buildingops.api.deps import Auth, CurrentContext, DbSession, Meta, Passwords, require
from buildingops.core.context import Context
from buildingops.core.pagination import Page
from buildingops.core.permissions import Permission
from buildingops.modules.audit import service as audit
from buildingops.modules.identity import members_service, organizations_service
from buildingops.modules.identity.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    MemberCreate,
    MemberCreated,
    MemberFilters,
    MemberRead,
    MemberUpdate,
    MeRead,
    OrganizationCreate,
    OrganizationRead,
    OrganizationStatusUpdate,
    OrganizationUpdate,
    PlatformOrganizationFilters,
    PlatformOrganizationRead,
    SwitchOrganizationRequest,
)

# --- authentication ----------------------------------------------------------------------

auth_router = APIRouter(prefix="/auth", tags=["auth"])


@auth_router.post("/login", summary="Sign in with email and password")
def login(payload: LoginRequest, db: DbSession, meta: Meta, auth: Auth) -> LoginResponse:
    result = auth.login(db, email=payload.email, password=payload.password, meta=meta)
    ctx = Context(db=db, principal=result.principal, meta=meta)
    if result.principal.organization_id or result.principal.is_platform_admin:
        audit.record(
            ctx,
            action="auth.signed_in",
            entity_type="user",
            entity_id=result.principal.user_id,
            summary=f"{result.principal.full_name} signed in",
        )
    return LoginResponse(session_token=result.token, expires_at=result.expires_at, me=auth.me(ctx))


@auth_router.post(
    "/logout", status_code=status.HTTP_204_NO_CONTENT, summary="End the current session"
)
def logout(ctx: CurrentContext, auth: Auth) -> Response:
    auth.logout(ctx)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@auth_router.get("/me", summary="The signed-in user, active organization and permissions")
def read_me(ctx: CurrentContext, auth: Auth) -> MeRead:
    return auth.me(ctx)


@auth_router.post("/switch-organization", summary="Make another organization active")
def switch_organization(
    payload: SwitchOrganizationRequest, ctx: CurrentContext, auth: Auth
) -> MeRead:
    return auth.me(auth.switch_organization(ctx, payload.organization_id))


@auth_router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change your password and sign out your other sessions",
)
def change_password(payload: ChangePasswordRequest, ctx: CurrentContext, auth: Auth) -> Response:
    auth.change_password(
        ctx, current_password=payload.current_password, new_password=payload.new_password
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- the active organization -------------------------------------------------------------

organization_router = APIRouter(prefix="/organization", tags=["organization"])


@organization_router.get("", summary="The active organization's profile")
def read_organization(
    ctx: Annotated[Context, Depends(require(Permission.ORGANIZATION_READ))],
) -> OrganizationRead:
    return OrganizationRead.model_validate(organizations_service.get_current(ctx))


@organization_router.patch("", summary="Update the active organization's profile")
def update_organization(
    payload: OrganizationUpdate,
    ctx: Annotated[Context, Depends(require(Permission.ORGANIZATION_UPDATE))],
) -> OrganizationRead:
    return OrganizationRead.model_validate(organizations_service.update_current(ctx, payload))


# --- members -----------------------------------------------------------------------------

members_router = APIRouter(prefix="/members", tags=["members"])


@members_router.get("", summary="List members of the active organization")
def list_members(
    filters: Annotated[MemberFilters, Query()],
    ctx: Annotated[Context, Depends(require(Permission.MEMBERS_READ))],
) -> Page[MemberRead]:
    items, total = members_service.list_members(ctx, filters)
    return Page[MemberRead](
        items=items, total=total, page=filters.page, page_size=filters.page_size
    )


@members_router.post("", status_code=status.HTTP_201_CREATED, summary="Add a member")
def create_member(
    payload: MemberCreate,
    passwords: Passwords,
    ctx: Annotated[Context, Depends(require(Permission.MEMBERS_MANAGE))],
) -> MemberCreated:
    return members_service.create_member(ctx, passwords, payload)


@members_router.get("/{member_id}", summary="Get a member")
def read_member(
    member_id: UUID, ctx: Annotated[Context, Depends(require(Permission.MEMBERS_READ))]
) -> MemberRead:
    return members_service.get_member(ctx, member_id)


@members_router.patch("/{member_id}", summary="Change a member's role, status or title")
def update_member(
    member_id: UUID,
    payload: MemberUpdate,
    ctx: Annotated[Context, Depends(require(Permission.MEMBERS_MANAGE))],
) -> MemberRead:
    return members_service.update_member(ctx, member_id, payload)


# --- platform administration -------------------------------------------------------------

platform_router = APIRouter(prefix="/platform", tags=["platform"])

_PlatformContext = Annotated[Context, Depends(require(Permission.PLATFORM_ORGANIZATIONS))]


@platform_router.get("/organizations", summary="List every organization on the platform")
def list_organizations(
    filters: Annotated[PlatformOrganizationFilters, Query()], ctx: _PlatformContext
) -> Page[PlatformOrganizationRead]:
    items, total = organizations_service.list_organizations(ctx, filters)
    return Page[PlatformOrganizationRead](
        items=items, total=total, page=filters.page, page_size=filters.page_size
    )


@platform_router.post(
    "/organizations",
    status_code=status.HTTP_201_CREATED,
    summary="Create an organization and its first company administrator",
)
def create_organization(
    payload: OrganizationCreate, passwords: Passwords, ctx: _PlatformContext
) -> PlatformOrganizationRead:
    return organizations_service.create_organization(ctx, passwords, payload)


@platform_router.patch(
    "/organizations/{organization_id}", summary="Activate or suspend an organization"
)
def set_organization_status(
    organization_id: UUID, payload: OrganizationStatusUpdate, ctx: _PlatformContext
) -> PlatformOrganizationRead:
    return organizations_service.set_organization_status(ctx, organization_id, payload.status)
