import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

from buildingops.core.models import utcnow
from buildingops.core.permissions import Role
from buildingops.modules.workforce.models import EmployeeStatus, EmploymentType, JobRole
from tests.conftest import ActorFactory, Factory, audit_entries, problem

EMPLOYEES = "/api/v1/employees"


def _new_employee(job_role: JobRole, **overrides):
    payload = {
        "first_name": "Maria",
        "last_name": "Lopez",
        "job_role_id": str(job_role.id),
        "employment_type": "full_time",
    }
    payload.update(overrides)
    return payload


def _today_in(timezone: str) -> str:
    return datetime.now(ZoneInfo(timezone)).date().isoformat()


def test_an_employee_is_created_with_the_next_number(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    porter = factory.job_role(admin.organization, name="Day Porter")
    lead = factory.employee(admin.organization, first_name="Sam", last_name="Reed")

    response = admin.post(
        EMPLOYEES,
        json=_new_employee(
            porter, hire_date="2024-03-04", hourly_rate="19", supervisor_id=str(lead.id)
        ),
    )

    assert response.status_code == 201
    created = response.json()
    assert created["employee_number"] == "EMP-0001"
    assert created["full_name"] == "Maria Lopez"
    assert created["job_role"] == {"id": str(porter.id), "name": "Day Porter"}
    assert created["supervisor"] == {"id": str(lead.id), "full_name": "Sam Reed"}
    assert (created["status"], created["hire_date"], created["hourly_rate"]) == (
        "active",
        "2024-03-04",
        "19.00",
    )
    assert (created["primary_building"], created["assignments"]) == (None, [])
    assert admin.get(f"{EMPLOYEES}/{created['id']}").json() == created
    (entry,) = audit_entries(admin, "employee", created["id"])
    assert entry["action"] == "employee.created"
    assert entry["summary"] == "Created employee Maria Lopez (EMP-0001)"
    assert entry["changes"]["job_role_id"] == {"from": None, "to": str(porter.id)}


def test_listing_supports_search_filters_and_sorting(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    porter = factory.job_role(organization, name="Day Porter")
    supervisor = factory.job_role(organization, name="Site Supervisor", is_supervisory=True)
    tower = factory.building(organization, name="Tower One")
    zamora = factory.employee(
        organization,
        supervisor,
        first_name="Ana",
        last_name="Zamora",
        employee_number="E-100",
        hire_date=date(2021, 5, 3),
    )
    factory.employee(
        organization,
        porter,
        first_name="Bo",
        last_name="Adams",
        email="bo.adams@example.com",
        employment_type=EmploymentType.PART_TIME,
        status=EmployeeStatus.ON_LEAVE,
        hire_date=date(2024, 9, 16),
    )
    al = factory.employee(organization, porter, first_name="Al", last_name="Adams")
    factory.employee(organization, porter, first_name="Gone", last_name="Away", deleted_at=utcnow())
    factory.employee(factory.organization(), first_name="Ana", last_name="Elsewhere")
    factory.assignment(zamora, tower)
    factory.assignment(al, tower, ends_on=date(2026, 3, 31))  # no longer there

    def names(**params) -> list[str]:
        response = admin.get(EMPLOYEES, params=params)
        assert response.status_code == 200, response.text
        return [item["full_name"] for item in response.json()["items"]]

    # By last name, then first name.
    assert names() == ["Al Adams", "Bo Adams", "Ana Zamora"]
    assert names(sort="-name") == ["Ana Zamora", "Bo Adams", "Al Adams"]
    assert names(sort="hire_date") == ["Ana Zamora", "Bo Adams", "Al Adams"]  # no date comes last
    assert names(job_role_id=str(porter.id)) == ["Al Adams", "Bo Adams"]
    assert names(status="on_leave") == names(employment_type="part_time") == ["Bo Adams"]
    assert names(building_id=str(tower.id)) == ["Ana Zamora"]
    # Whether their job role is a supervisory one: the people who can be someone's supervisor.
    assert names(supervisory="true") == ["Ana Zamora"]
    assert names(supervisory="false") == ["Al Adams", "Bo Adams"]
    assert names(q="ana zam") == names(q="e-100") == ["Ana Zamora"]
    assert names(q="BO.ADAMS@") == ["Bo Adams"]
    assert names(page_size=2, page=2) == ["Ana Zamora"]
    assert admin.get(EMPLOYEES).json()["total"] == 3


def test_an_employee_is_read_with_supervisor_primary_building_and_assignments(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    lead = factory.employee(organization, first_name="Sam", last_name="Reed")
    employee = factory.employee(organization, supervisor_id=lead.id)
    tower = factory.building(organization, name="Tower One")
    depot = factory.building(organization, name="Pier Nine Depot")
    annex = factory.building(organization, name="Old Annex")
    factory.assignment(employee, annex, starts_on=date(2024, 1, 8), ends_on=date(2025, 6, 30))
    factory.assignment(employee, depot, starts_on=date(2025, 7, 1))
    factory.assignment(employee, tower, starts_on=date(2026, 2, 2), is_primary=True)

    detail = admin.get(f"{EMPLOYEES}/{employee.id}").json()
    (listed,) = [
        item for item in admin.get(EMPLOYEES).json()["items"] if item["id"] == str(employee.id)
    ]

    assert detail["supervisor"] == {"id": str(lead.id), "full_name": "Sam Reed"}
    assert detail["primary_building"] == {"id": str(tower.id), "name": "Tower One"}
    # Open assignments first, newest first, then the ones that have ended.
    assert [
        (a["building"]["name"], a["is_primary"], a["ends_on"]) for a in detail["assignments"]
    ] == [
        ("Tower One", True, None),
        ("Pier Nine Depot", False, None),
        ("Old Annex", False, "2025-06-30"),
    ]
    assert "assignments" not in listed
    assert {key: value for key, value in detail.items() if key != "assignments"} == listed


def test_the_job_role_must_be_a_live_one_from_the_same_organization(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    foreign = factory.job_role(factory.organization())
    archived = factory.job_role(admin.organization, deleted_at=utcnow())

    for job_role in (foreign, archived):
        response = admin.post(EMPLOYEES, json=_new_employee(job_role))
        assert response.status_code == 422
        assert problem(response)["errors"] == [
            {"field": "job_role_id", "message": "Job role not found.", "code": "not_found"}
        ]


def test_a_supervisor_must_be_another_live_employee_of_the_organization(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    employee = factory.employee(organization, first_name="Maria", last_name="Lopez")
    colleague = factory.employee(organization, first_name="Sam", last_name="Reed")
    archived = factory.employee(organization, deleted_at=utcnow())
    foreign = factory.employee(factory.organization())
    url = f"{EMPLOYEES}/{employee.id}"

    def refusal(supervisor_id: uuid.UUID) -> dict:
        response = admin.patch(url, json={"supervisor_id": str(supervisor_id)})
        assert response.status_code == 422
        (error,) = problem(response)["errors"]
        assert error["field"] == "supervisor_id"
        return error

    assert refusal(employee.id)["message"] == "An employee cannot be their own supervisor."
    assert refusal(archived.id)["message"] == "Supervisor not found."
    assert refusal(foreign.id)["message"] == "Supervisor not found."

    accepted = admin.patch(url, json={"supervisor_id": str(colleague.id)})
    assert accepted.status_code == 200
    assert accepted.json()["supervisor"] == {"id": str(colleague.id), "full_name": "Sam Reed"}

    cleared = admin.patch(url, json={"supervisor_id": None})
    assert cleared.json()["supervisor"] is None


def test_supervision_cannot_run_in_a_circle(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    director = factory.employee(organization, first_name="Dee", last_name="Okoro")
    manager = factory.employee(
        organization, first_name="Sam", last_name="Reed", supervisor_id=director.id
    )
    porter = factory.employee(
        organization, first_name="Maria", last_name="Lopez", supervisor_id=manager.id
    )

    # The director would report to someone who, through the manager, reports to them.
    response = admin.patch(f"{EMPLOYEES}/{director.id}", json={"supervisor_id": str(porter.id)})

    assert response.status_code == 422
    assert problem(response)["errors"] == [
        {
            "field": "supervisor_id",
            "message": "Maria Lopez reports to Dee Okoro, so cannot also be their supervisor.",
            "code": "supervision_loop",
        }
    ]


def test_a_login_can_be_linked_to_one_employee(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    porter = factory.job_role(admin.organization)
    _, membership = factory.member(admin.organization, Role.EMPLOYEE)
    _, foreign_membership = factory.member(factory.organization(), Role.EMPLOYEE)

    linked = admin.post(EMPLOYEES, json=_new_employee(porter, membership_id=str(membership.id)))
    again = admin.post(EMPLOYEES, json=_new_employee(porter, membership_id=str(membership.id)))
    foreign = admin.post(
        EMPLOYEES, json=_new_employee(porter, membership_id=str(foreign_membership.id))
    )

    assert linked.status_code == 201
    assert linked.json()["membership_id"] == str(membership.id)
    assert again.status_code == 409
    assert problem(again)["errors"] == [
        {
            "field": "membership_id",
            "message": "This login is already linked to another employee.",
        }
    ]
    assert foreign.status_code == 422
    assert problem(foreign)["errors"] == [
        {"field": "membership_id", "message": "Member not found.", "code": "not_found"}
    ]


def test_numbers_and_emails_are_unique_among_live_employees(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    porter = factory.job_role(organization)
    factory.employee(organization, porter, employee_number="E-1", email="maria@example.com")
    factory.employee(
        organization, porter, employee_number="E-2", email="sam@example.com", deleted_at=utcnow()
    )
    colleague = factory.employee(organization, porter)

    same_number = admin.post(EMPLOYEES, json=_new_employee(porter, employee_number="e-1"))
    same_email = admin.post(EMPLOYEES, json=_new_employee(porter, email="Maria@Example.com"))
    renumbered = admin.patch(f"{EMPLOYEES}/{colleague.id}", json={"employee_number": "E-1"})
    readdressed = admin.patch(f"{EMPLOYEES}/{colleague.id}", json={"email": "maria@example.com"})
    freed = admin.post(
        EMPLOYEES, json=_new_employee(porter, employee_number="E-2", email="sam@example.com")
    )

    assert same_number.status_code == renumbered.status_code == 409
    assert same_email.status_code == readdressed.status_code == 409
    assert problem(renumbered)["errors"] == [
        {"field": "employee_number", "message": "E-1 is already in use."}
    ]
    assert problem(readdressed)["errors"] == [
        {"field": "email", "message": "Another employee already has this email address."}
    ]
    assert freed.status_code == 201  # an archived employee holds neither


def test_termination_cannot_come_before_hiring(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    porter = factory.job_role(admin.organization)
    employee = factory.employee(admin.organization, porter, hire_date=date(2024, 3, 4))

    on_create = admin.post(
        EMPLOYEES,
        json=_new_employee(porter, hire_date="2024-03-04", termination_date="2024-03-03"),
    )
    on_update = admin.patch(f"{EMPLOYEES}/{employee.id}", json={"termination_date": "2023-12-31"})

    assert on_create.status_code == on_update.status_code == 422
    assert problem(on_update)["errors"] == [
        {
            "field": "termination_date",
            "message": "The termination date cannot be before the hire date (2024-03-04).",
            "code": "terminated_before_hired",
        }
    ]


def test_terminating_without_a_date_uses_today_in_the_organizations_time_zone(
    make_actor: ActorFactory, factory: Factory
):
    # The two zones are 26 hours apart, so they never share a calendar date.
    earliest, latest = "Etc/GMT+12", "Pacific/Kiritimati"
    dates = {}
    for timezone in (earliest, latest):
        admin = make_actor(organization=factory.organization(timezone=timezone))
        employee = factory.employee(admin.organization)
        before = _today_in(timezone)
        response = admin.patch(f"{EMPLOYEES}/{employee.id}", json={"status": "terminated"})
        assert response.status_code == 200
        dates[timezone] = response.json()["termination_date"]
        assert dates[timezone] in {before, _today_in(timezone)}

    assert dates[earliest] < dates[latest]


def test_a_terminated_employee_keeps_a_termination_date(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    porter = factory.job_role(admin.organization)

    created = admin.post(
        EMPLOYEES,
        json=_new_employee(porter, status="terminated", termination_date="2026-01-31"),
    )
    cleared = admin.patch(f"{EMPLOYEES}/{created.json()['id']}", json={"termination_date": None})

    assert created.status_code == 201
    assert created.json()["termination_date"] == "2026-01-31"  # a given date is kept
    assert cleared.status_code == 422
    assert problem(cleared)["errors"] == [
        {
            "field": "termination_date",
            "message": "A terminated employee needs a termination date.",
            "code": "required",
        }
    ]


def test_invalid_input_is_reported_per_field(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    porter = factory.job_role(admin.organization)

    response = admin.post(
        EMPLOYEES,
        json=_new_employee(
            porter,
            first_name="",
            employment_type="volunteer",
            email="maria.lopez",
            hire_date="03/04/2024",
            hourly_rate=-5,
            supervisor_id="not-an-id",
        ),
    )

    assert response.status_code == 422
    assert {error["field"] for error in problem(response)["errors"]} == {
        "first_name",
        "employment_type",
        "email",
        "hire_date",
        "hourly_rate",
        "supervisor_id",
    }


def test_employees_of_another_organization_are_not_found(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    foreign = factory.employee(factory.organization())
    url = f"{EMPLOYEES}/{foreign.id}"

    assert admin.get(url).status_code == 404
    assert admin.patch(url, json={"first_name": "Taken"}).status_code == 404
    assert admin.delete(url).status_code == 404


def test_updating_an_employee_records_what_changed(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    porter = factory.job_role(organization, name="Day Porter")
    lead = factory.job_role(organization, name="Lead Porter")
    employee = factory.employee(
        organization, porter, first_name="Maria", last_name="Lopez", employee_number="E-7"
    )

    response = admin.patch(
        f"{EMPLOYEES}/{employee.id}",
        json={"job_role_id": str(lead.id), "hourly_rate": "23.75", "status": "on_leave"},
    )

    assert response.status_code == 200
    assert response.json()["job_role"] == {"id": str(lead.id), "name": "Lead Porter"}
    (entry,) = audit_entries(admin, "employee", employee.id)
    assert entry["action"] == "employee.updated"
    assert entry["summary"] == "Updated employee Maria Lopez (E-7): hourly rate, job role, status"
    assert entry["changes"] == {
        "job_role_id": {"from": str(porter.id), "to": str(lead.id)},
        "hourly_rate": {"from": None, "to": "23.75"},
        "status": {"from": "active", "to": "on_leave"},
    }


def test_an_employee_with_reports_or_open_assignments_cannot_be_archived(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    lead = factory.employee(organization, first_name="Sam", last_name="Reed")
    report = factory.employee(organization, supervisor_id=lead.id)
    assignment = factory.assignment(lead, factory.building(organization))
    url = f"{EMPLOYEES}/{lead.id}"

    refused = admin.delete(url)

    assert refused.status_code == 409
    assert problem(refused)["detail"] == (
        "Sam Reed still has 1 direct report and 1 open assignment."
        " Before archiving, give them another supervisor and end the assignments."
    )

    admin.patch(f"{EMPLOYEES}/{report.id}", json={"supervisor_id": None})
    admin.patch(f"{url}/assignments/{assignment.id}", json={"ends_on": "2026-06-30"})

    assert admin.delete(url).status_code == 204
    assert admin.get(url).status_code == 404


def test_archiving_an_employee_releases_their_login(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    porter = factory.job_role(organization)
    _, membership = factory.member(organization, Role.EMPLOYEE)
    employee = factory.employee(
        organization,
        porter,
        first_name="Maria",
        last_name="Lopez",
        employee_number="E-7",
        membership_id=membership.id,
    )

    assert admin.delete(f"{EMPLOYEES}/{employee.id}").status_code == 204

    entry = audit_entries(admin, "employee", employee.id)[0]
    assert (entry["action"], entry["summary"]) == (
        "employee.archived",
        "Archived employee Maria Lopez (E-7)",
    )
    assert entry["changes"]["membership_id"] == {"from": str(membership.id), "to": None}
    # The same person can be entered again and given their login back.
    rehired = admin.post(EMPLOYEES, json=_new_employee(porter, membership_id=str(membership.id)))
    assert rehired.status_code == 201
