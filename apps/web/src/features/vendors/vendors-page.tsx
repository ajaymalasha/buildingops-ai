"use client";

import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Plus, SearchX, Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useCan, useMe } from "@/components/me-provider";
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
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import type { Vendor } from "@/lib/api/types";
import { todayInZone } from "@/lib/dates";
import { optionsFrom, pick } from "@/lib/forms";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

import { insuranceFlag, insuranceStatus } from "./insurance";
import {
  VENDOR_CATEGORIES,
  VENDOR_CATEGORY_LABELS,
  VENDOR_STATUS_LABELS,
  VENDOR_STATUS_TONES,
  VENDOR_STATUSES,
} from "./vendor-form-schema";
import { VendorSheet } from "./vendor-sheet";

const PAGE_SIZE = 25;

export function VendorsPage() {
  return useCan("vendors:read") ? <VendorList /> : <NoAccess what="vendors" />;
}

/** The expiry date, with a second line when the certificate has lapsed or is about to. */
function Insurance({ expiresOn, today }: { expiresOn: string | null; today: string }) {
  if (!expiresOn) return <span className="text-ink-subtle">Not on file</span>;
  const status = insuranceStatus(expiresOn, today);
  const flag = insuranceFlag(status);
  return (
    <StackedCell
      className="min-w-0 whitespace-nowrap"
      primary={<span className="tabular-nums">{formatDay(expiresOn)}</span>}
      secondary={
        flag ? (
          <span
            className={cn(
              "font-medium",
              status.state === "lapsed" ? "text-critical" : "text-caution",
            )}
          >
            {flag}
          </span>
        ) : null
      }
    />
  );
}

function VendorList() {
  const me = useMe();
  const canWrite = useCan("vendors:write");
  const list = useListParams();
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  const [archiving, setArchiving] = useState<Vendor | null>(null);

  const status = pick(list.get("status"), VENDOR_STATUSES);
  const category = pick(list.get("category"), VENDOR_CATEGORIES);
  const sort = list.get("sort");
  // Insurance runs out on a calendar day, where the organization is.
  const today = todayInZone(me.organization?.timezone ?? "UTC");

  const vendors = $api.useQuery(
    "get",
    "/api/v1/vendors",
    {
      params: {
        query: { q: list.get("q"), status, category, sort, page: list.page, page_size: PAGE_SIZE },
      },
    },
    { placeholderData: keepPreviousData },
  );

  const columns: Column<Vendor>[] = [
    {
      id: "name",
      header: "Vendor",
      sortKey: "name",
      cell: (vendor) => <NameCell name={vendor.name} code={vendor.code} />,
    },
    {
      id: "category",
      header: "Category",
      cell: (vendor) => (
        <span className="whitespace-nowrap">{VENDOR_CATEGORY_LABELS[vendor.category]}</span>
      ),
    },
    {
      id: "contact",
      header: "Contact",
      cell: (vendor) =>
        vendor.contact_name || vendor.email ? (
          <StackedCell
            primary={vendor.contact_name ?? vendor.email}
            secondary={vendor.contact_name ? vendor.email : null}
          />
        ) : (
          <Blank label="No contact" />
        ),
    },
    {
      id: "phone",
      header: "Phone",
      cell: (vendor) =>
        vendor.phone ? (
          <span className="whitespace-nowrap tabular-nums">{vendor.phone}</span>
        ) : (
          <Blank label="No phone number" />
        ),
    },
    {
      id: "insurance",
      header: "Insurance expires",
      sortKey: "insurance_expires_on",
      cell: (vendor) => <Insurance expiresOn={vendor.insurance_expires_on} today={today} />,
    },
    {
      id: "status",
      header: "Status",
      cell: (vendor) => (
        <Badge dot tone={VENDOR_STATUS_TONES[vendor.status]}>
          {VENDOR_STATUS_LABELS[vendor.status]}
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
      cell: (vendor) => (
        <RowActions label={`Actions for ${vendor.name}`}>
          <DropdownMenuItem onSelect={() => setEditing(vendor)}>Edit vendor</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem tone="danger" onSelect={() => setArchiving(vendor)}>
            Archive vendor
          </DropdownMenuItem>
        </RowActions>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Vendors"
        description="Subcontractors and suppliers, and whether the insurance each has on file is still valid."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus />
              New vendor
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput
            label="Search vendors"
            placeholder="Search by name, code or contact"
            value={list.get("q")}
            onChange={(q) => list.update({ q })}
            className="w-full sm:w-72"
          />
          <FilterSelect
            label="Filter by category"
            placeholder="All categories"
            value={category}
            options={optionsFrom(VENDOR_CATEGORY_LABELS)}
            onChange={(value) => list.update({ category: value })}
          />
          <FilterSelect
            label="Filter by status"
            placeholder="Any status"
            value={status}
            options={optionsFrom(VENDOR_STATUS_LABELS)}
            onChange={(value) => list.update({ status: value })}
            className="w-48"
          />
          {list.hasFilters ? (
            <Button variant="ghost" size="sm" onClick={list.clear}>
              Clear filters
            </Button>
          ) : null}
        </div>

        <DataTable
          caption="Vendors"
          columns={columns}
          rows={vendors.data?.items}
          rowKey={(vendor) => vendor.id}
          isLoading={vendors.isPending}
          isRefreshing={vendors.isPlaceholderData}
          error={vendors.error}
          onRetry={() => void vendors.refetch()}
          sort={sort}
          onSortChange={(next) => list.update({ sort: next })}
          empty={
            list.hasFilters ? (
              <EmptyState
                icon={SearchX}
                title="No vendors match these filters"
                description="Try a different search, or clear the filters to see every vendor."
                action={
                  <Button size="sm" onClick={list.clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Truck}
                title="No vendors yet"
                description="Add the subcontractors and suppliers you work with, and keep their insurance dates here."
                action={
                  canWrite ? (
                    <Button size="sm" onClick={() => setEditing("new")}>
                      New vendor
                    </Button>
                  ) : null
                }
              />
            )
          }
        />

        {vendors.data && vendors.data.total > 0 ? (
          <Pagination
            page={vendors.data.page}
            pageSize={vendors.data.page_size}
            total={vendors.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="vendors"
          />
        ) : null}
      </Panel>

      <VendorSheet target={editing} onClose={() => setEditing(null)} />
      {archiving ? <ArchiveVendor vendor={archiving} onDone={() => setArchiving(null)} /> : null}
    </>
  );
}

function ArchiveVendor({ vendor, onDone }: { vendor: Vendor; onDone: () => void }) {
  const queryClient = useQueryClient();
  const archive = $api.useMutation("delete", "/api/v1/vendors/{vendor_id}", {
    onSuccess: async () => {
      await invalidate(queryClient, "/api/v1/vendors");
      toast.success(`${vendor.name} was archived`);
      onDone();
    },
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onDone()}
      title={`Archive ${vendor.name}?`}
      description="It leaves the vendor list, and its code becomes free to use again. Archiving cannot be undone from the app."
      confirmLabel="Archive vendor"
      tone="danger"
      loading={archive.isPending}
      error={archive.error}
      onConfirm={() => archive.mutate({ params: { path: { vendor_id: vendor.id } } })}
    />
  );
}
