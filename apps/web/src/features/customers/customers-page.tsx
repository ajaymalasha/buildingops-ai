"use client";

import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Handshake, Plus, SearchX } from "lucide-react";
import Link from "next/link";
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
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import type { Customer } from "@/lib/api/types";
import { optionsFrom, pick } from "@/lib/forms";
import { formatNumber } from "@/lib/format";

import {
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_STATUS_TONES,
  CUSTOMER_STATUSES,
} from "./customer-form-schema";
import { CustomerSheet } from "./customer-sheet";

const PAGE_SIZE = 25;

export function CustomersPage() {
  return useCan("customers:read") ? <CustomerList /> : <NoAccess what="customers" />;
}

function CustomerList() {
  const canWrite = useCan("customers:write");
  const canSeeBuildings = useCan("buildings:read");
  const list = useListParams();
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [archiving, setArchiving] = useState<Customer | null>(null);

  const status = pick(list.get("status"), CUSTOMER_STATUSES);
  const sort = list.get("sort");

  const customers = $api.useQuery(
    "get",
    "/api/v1/customers",
    {
      params: { query: { q: list.get("q"), status, sort, page: list.page, page_size: PAGE_SIZE } },
    },
    { placeholderData: keepPreviousData },
  );

  const columns: Column<Customer>[] = [
    {
      id: "name",
      header: "Customer",
      sortKey: "name",
      cell: (customer) => <NameCell name={customer.name} code={customer.code} />,
    },
    {
      id: "contact",
      header: "Primary contact",
      cell: (customer) =>
        customer.contact_name || customer.email ? (
          <StackedCell
            primary={customer.contact_name ?? customer.email}
            secondary={customer.contact_name ? customer.email : null}
          />
        ) : (
          <Blank label="No contact" />
        ),
    },
    {
      id: "phone",
      header: "Phone",
      cell: (customer) =>
        customer.phone ? (
          <span className="whitespace-nowrap tabular-nums">{customer.phone}</span>
        ) : (
          <Blank label="No phone number" />
        ),
    },
    {
      id: "buildings",
      header: "Buildings",
      align: "end",
      cell: (customer) =>
        customer.building_count > 0 && canSeeBuildings ? (
          <Link
            href={`/buildings?customer_id=${customer.id}`}
            prefetch={false}
            aria-label={`Buildings of ${customer.name}: ${customer.building_count}`}
            className="font-medium text-brand-700 hover:text-brand-800 hover:underline"
          >
            {formatNumber(customer.building_count)}
          </Link>
        ) : (
          <span className={customer.building_count === 0 ? "text-ink-subtle" : undefined}>
            {formatNumber(customer.building_count)}
          </span>
        ),
    },
    {
      id: "terms",
      header: "Payment terms",
      cell: (customer) => `Net ${customer.payment_terms_days}`,
    },
    {
      id: "status",
      header: "Status",
      cell: (customer) => (
        <Badge dot tone={CUSTOMER_STATUS_TONES[customer.status]}>
          {CUSTOMER_STATUS_LABELS[customer.status]}
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
      cell: (customer) => (
        <RowActions label={`Actions for ${customer.name}`}>
          <DropdownMenuItem onSelect={() => setEditing(customer)}>Edit customer</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem tone="danger" onSelect={() => setArchiving(customer)}>
            Archive customer
          </DropdownMenuItem>
        </RowActions>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Customers"
        description="The companies you service buildings for, with who to call and how they pay."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus />
              New customer
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput
            label="Search customers"
            placeholder="Search by name, code or contact"
            value={list.get("q")}
            onChange={(q) => list.update({ q })}
            className="w-full sm:w-72"
          />
          <FilterSelect
            label="Filter by status"
            placeholder="Any status"
            value={status}
            options={optionsFrom(CUSTOMER_STATUS_LABELS)}
            onChange={(value) => list.update({ status: value })}
          />
          {list.hasFilters ? (
            <Button variant="ghost" size="sm" onClick={list.clear}>
              Clear filters
            </Button>
          ) : null}
        </div>

        <DataTable
          caption="Customers"
          columns={columns}
          rows={customers.data?.items}
          rowKey={(customer) => customer.id}
          isLoading={customers.isPending}
          isRefreshing={customers.isPlaceholderData}
          error={customers.error}
          onRetry={() => void customers.refetch()}
          sort={sort}
          onSortChange={(next) => list.update({ sort: next })}
          empty={
            list.hasFilters ? (
              <EmptyState
                icon={SearchX}
                title="No customers match these filters"
                description="Try a different search, or clear the filters to see every customer."
                action={
                  <Button size="sm" onClick={list.clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Handshake}
                title="No customers yet"
                description="Add the companies you service buildings for. Their buildings and contracts come next."
                action={
                  canWrite ? (
                    <Button size="sm" onClick={() => setEditing("new")}>
                      New customer
                    </Button>
                  ) : null
                }
              />
            )
          }
        />

        {customers.data && customers.data.total > 0 ? (
          <Pagination
            page={customers.data.page}
            pageSize={customers.data.page_size}
            total={customers.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="customers"
          />
        ) : null}
      </Panel>

      <CustomerSheet target={editing} onClose={() => setEditing(null)} />
      {archiving ? (
        <ArchiveCustomer customer={archiving} onDone={() => setArchiving(null)} />
      ) : null}
    </>
  );
}

function ArchiveCustomer({ customer, onDone }: { customer: Customer; onDone: () => void }) {
  const queryClient = useQueryClient();
  const archive = $api.useMutation("delete", "/api/v1/customers/{customer_id}", {
    onSuccess: async () => {
      await invalidate(queryClient, "/api/v1/customers");
      toast.success(`${customer.name} was archived`);
      onDone();
    },
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onDone()}
      title={`Archive ${customer.name}?`}
      description="It leaves the customer list and can no longer be chosen for buildings or contracts. Its code becomes free to use again. Archiving cannot be undone from the app."
      confirmLabel="Archive customer"
      tone="danger"
      loading={archive.isPending}
      error={archive.error}
      onConfirm={() => archive.mutate({ params: { path: { customer_id: customer.id } } })}
    />
  );
}
