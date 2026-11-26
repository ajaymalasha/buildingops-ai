"use client";

import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Building as BuildingIcon, Plus, SearchX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useCan } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Blank, NameCell, StackedCell } from "@/components/ui/cells";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DropdownMenuItem, DropdownMenuSeparator, RowActions } from "@/components/ui/dropdown-menu";
import { FilterSelect } from "@/components/ui/filter-select";
import { PageHeader, Panel } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState, NoAccess } from "@/components/ui/states";
import { useListParams } from "@/hooks/use-list-params";
import { useCustomerOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import type { Building } from "@/lib/api/types";
import { optionsFrom, pick, pickId, recordOptions } from "@/lib/forms";
import { formatNumber } from "@/lib/format";

import {
  BUILDING_STATUS_LABELS,
  BUILDING_STATUS_TONES,
  BUILDING_STATUSES,
  BUILDING_TYPE_LABELS,
  BUILDING_TYPES,
} from "./building-form-schema";
import { BuildingSheet } from "./building-sheet";

const PAGE_SIZE = 25;

export function BuildingsPage() {
  return useCan("buildings:read") ? <BuildingList /> : <NoAccess what="buildings" />;
}

function BuildingList() {
  const canWrite = useCan("buildings:write");
  const canSeeCustomers = useCan("customers:read");
  const list = useListParams();
  const [editing, setEditing] = useState<Building | "new" | null>(null);
  const [archiving, setArchiving] = useState<Building | null>(null);

  const status = pick(list.get("status"), BUILDING_STATUSES);
  const buildingType = pick(list.get("building_type"), BUILDING_TYPES);
  const customerId = pickId(list.get("customer_id"));
  const sort = list.get("sort");

  const buildings = $api.useQuery(
    "get",
    "/api/v1/buildings",
    {
      params: {
        query: {
          q: list.get("q"),
          status,
          building_type: buildingType,
          customer_id: customerId,
          sort,
          page: list.page,
          page_size: PAGE_SIZE,
        },
      },
    },
    { placeholderData: keepPreviousData },
  );
  const customers = useCustomerOptions({ enabled: canSeeCustomers });

  const columns: Column<Building>[] = [
    {
      id: "name",
      header: "Building",
      sortKey: "name",
      cell: (building) => <NameCell name={building.name} code={building.code} />,
    },
    {
      id: "customer",
      header: "Customer",
      cell: (building) => <StackedCell primary={building.customer.name} />,
    },
    {
      id: "type",
      header: "Type",
      cell: (building) => (
        <span className="whitespace-nowrap">{BUILDING_TYPE_LABELS[building.building_type]}</span>
      ),
    },
    {
      id: "location",
      header: "Location",
      sortKey: "city",
      cell: (building) => (
        <StackedCell
          primary={[building.city, building.region].filter(Boolean).join(", ")}
          secondary={building.address_line1}
        />
      ),
    },
    {
      id: "size",
      header: "Size",
      sortKey: "square_feet",
      align: "end",
      cell: (building) =>
        building.square_feet || building.floors ? (
          <StackedCell
            className="ml-auto min-w-0 whitespace-nowrap"
            primary={
              building.square_feet ? (
                `${formatNumber(building.square_feet)} sq ft`
              ) : (
                <Blank label="Floor area not recorded" />
              )
            }
            secondary={
              building.floors
                ? `${formatNumber(building.floors)} ${building.floors === 1 ? "floor" : "floors"}`
                : null
            }
          />
        ) : (
          <Blank label="Size not recorded" />
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (building) => (
        <Badge dot tone={BUILDING_STATUS_TONES[building.status]}>
          {BUILDING_STATUS_LABELS[building.status]}
        </Badge>
      ),
    },
  ];

  if (canWrite) {
    columns.push({
      id: "actions",
      header: "",
      align: "end",
      width: "w-12",
      cell: (building) => (
        <RowActions label={`Actions for ${building.name}`}>
          <DropdownMenuItem onSelect={() => setEditing(building)}>Edit building</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem tone="danger" onSelect={() => setArchiving(building)}>
            Archive building
          </DropdownMenuItem>
        </RowActions>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Buildings"
        description="Every site your teams service, and the customer each one belongs to."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus />
              New building
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput
            label="Search buildings"
            placeholder="Search by name, code or address"
            value={list.get("q")}
            onChange={(q) => list.update({ q })}
            className="w-full sm:w-72"
          />
          {canSeeCustomers ? (
            <FilterSelect
              label="Filter by customer"
              placeholder="All customers"
              value={customerId}
              options={recordOptions(customers.data?.items ?? [])}
              onChange={(value) => list.update({ customer_id: value })}
              className="w-52"
            />
          ) : null}
          <FilterSelect
            label="Filter by type"
            placeholder="All types"
            value={buildingType}
            options={optionsFrom(BUILDING_TYPE_LABELS)}
            onChange={(value) => list.update({ building_type: value })}
            className="w-36"
          />
          <FilterSelect
            label="Filter by status"
            placeholder="Any status"
            value={status}
            options={optionsFrom(BUILDING_STATUS_LABELS)}
            onChange={(value) => list.update({ status: value })}
            className="w-36"
          />
          {list.hasFilters ? (
            <Button variant="ghost" size="sm" onClick={list.clear}>
              Clear filters
            </Button>
          ) : null}
        </div>

        <DataTable
          caption="Buildings"
          columns={columns}
          rows={buildings.data?.items}
          rowKey={(building) => building.id}
          isLoading={buildings.isPending}
          isRefreshing={buildings.isPlaceholderData}
          error={buildings.error}
          onRetry={() => void buildings.refetch()}
          sort={sort}
          onSortChange={(next) => list.update({ sort: next })}
          empty={
            list.hasFilters ? (
              <EmptyState
                icon={SearchX}
                title="No buildings match these filters"
                description="Try a different search, or clear the filters to see every building."
                action={
                  <Button size="sm" onClick={list.clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={BuildingIcon}
                title="No buildings yet"
                description="Add the sites you service. Each one belongs to a customer, so add the customer first."
                action={
                  canWrite ? (
                    <Button size="sm" onClick={() => setEditing("new")}>
                      New building
                    </Button>
                  ) : null
                }
              />
            )
          }
        />

        {buildings.data && buildings.data.total > 0 ? (
          <Pagination
            page={buildings.data.page}
            pageSize={buildings.data.page_size}
            total={buildings.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="buildings"
          />
        ) : null}
      </Panel>

      <BuildingSheet
        target={editing}
        defaultCustomerId={customerId}
        onClose={() => setEditing(null)}
      />
      {archiving ? (
        <ArchiveBuilding building={archiving} onDone={() => setArchiving(null)} />
      ) : null}
    </>
  );
}

function ArchiveBuilding({ building, onDone }: { building: Building; onDone: () => void }) {
  const queryClient = useQueryClient();
  const archive = $api.useMutation("delete", "/api/v1/buildings/{building_id}", {
    onSuccess: async () => {
      await invalidate(queryClient, "/api/v1/buildings", "/api/v1/customers");
      toast.success(`${building.name} was archived`);
      onDone();
    },
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onDone()}
      title={`Archive ${building.name}?`}
      description="It leaves the building list and can no longer be chosen for assignments or contracts. Its code becomes free to use again. Archiving cannot be undone from the app."
      confirmLabel="Archive building"
      tone="danger"
      loading={archive.isPending}
      error={archive.error}
      onConfirm={() => archive.mutate({ params: { path: { building_id: building.id } } })}
    />
  );
}
