"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { FilePenLine, Plus, SearchX } from "lucide-react";
import { useState } from "react";

import { useCan } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NameCell, StackedCell } from "@/components/ui/cells";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DropdownMenuItem, RowActions } from "@/components/ui/dropdown-menu";
import { FilterSelect } from "@/components/ui/filter-select";
import { PageHeader, Panel } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState, NoAccess } from "@/components/ui/states";
import { useListParams } from "@/hooks/use-list-params";
import { useCustomerOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import type { Contract } from "@/lib/api/types";
import { optionsFrom, pick, pickId, recordOptions } from "@/lib/forms";
import { formatDay, formatNumber } from "@/lib/format";

import {
  BILLING_MODEL_LABELS,
  BILLING_MODELS,
  billingSummary,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONES,
  CONTRACT_STATUSES,
} from "./contract-form-schema";
import { ContractSheet } from "./contract-sheet";

const PAGE_SIZE = 25;

export function ContractsPage() {
  return useCan("contracts:read") ? <ContractList /> : <NoAccess what="contracts" />;
}

function ContractList() {
  const canWrite = useCan("contracts:write");
  const canSeeCustomers = useCan("customers:read");
  const list = useListParams();
  const [editing, setEditing] = useState<Contract | "new" | null>(null);

  const status = pick(list.get("status"), CONTRACT_STATUSES);
  const billingModel = pick(list.get("billing_model"), BILLING_MODELS);
  const customerId = pickId(list.get("customer_id"));
  const sort = list.get("sort");

  const contracts = $api.useQuery(
    "get",
    "/api/v1/contracts",
    {
      params: {
        query: {
          q: list.get("q"),
          status,
          billing_model: billingModel,
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

  const columns: Column<Contract>[] = [
    {
      id: "name",
      header: "Contract",
      sortKey: "name",
      cell: (contract) => <NameCell name={contract.name} code={contract.contract_number} />,
    },
    {
      id: "customer",
      header: "Customer",
      cell: (contract) => <StackedCell primary={contract.customer.name} />,
    },
    {
      id: "billing",
      header: "Billing",
      cell: (contract) => (
        <StackedCell
          className="min-w-0 whitespace-nowrap tabular-nums"
          primary={BILLING_MODEL_LABELS[contract.billing_model]}
          secondary={billingSummary(contract)}
        />
      ),
    },
    {
      id: "buildings",
      header: "Buildings",
      align: "end",
      cell: (contract) => (
        <span className={contract.building_count === 0 ? "text-ink-subtle" : undefined}>
          {formatNumber(contract.building_count)}
        </span>
      ),
    },
    {
      id: "starts",
      header: "Starts",
      sortKey: "start_date",
      cell: (contract) => (
        <span className="whitespace-nowrap tabular-nums">{formatDay(contract.start_date)}</span>
      ),
    },
    {
      id: "ends",
      header: "Ends",
      sortKey: "end_date",
      cell: (contract) =>
        contract.end_date ? (
          <span className="whitespace-nowrap tabular-nums">{formatDay(contract.end_date)}</span>
        ) : (
          <span className="whitespace-nowrap text-ink-subtle">Open-ended</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (contract) => (
        <Badge dot tone={CONTRACT_STATUS_TONES[contract.status]}>
          {CONTRACT_STATUS_LABELS[contract.status]}
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
      cell: (contract) => (
        // A contract is never archived. It ends by moving to expired or terminated.
        <RowActions label={`Actions for ${contract.name} (${contract.contract_number})`}>
          <DropdownMenuItem onSelect={() => setEditing(contract)}>Edit contract</DropdownMenuItem>
        </RowActions>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Contracts"
        description="The agreements you bill under: who each is with, how it is billed and which buildings it covers."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus />
              New contract
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput
            label="Search contracts"
            placeholder="Search by name, number or customer"
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
            label="Filter by billing model"
            placeholder="Any billing model"
            value={billingModel}
            options={optionsFrom(BILLING_MODEL_LABELS)}
            onChange={(value) => list.update({ billing_model: value })}
            className="w-48"
          />
          <FilterSelect
            label="Filter by status"
            placeholder="Any status"
            value={status}
            options={optionsFrom(CONTRACT_STATUS_LABELS)}
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
          caption="Contracts"
          columns={columns}
          rows={contracts.data?.items}
          rowKey={(contract) => contract.id}
          isLoading={contracts.isPending}
          isRefreshing={contracts.isPlaceholderData}
          error={contracts.error}
          onRetry={() => void contracts.refetch()}
          sort={sort}
          onSortChange={(next) => list.update({ sort: next })}
          empty={
            list.hasFilters ? (
              <EmptyState
                icon={SearchX}
                title="No contracts match these filters"
                description="Try a different search, or clear the filters to see every contract."
                action={
                  <Button size="sm" onClick={list.clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={FilePenLine}
                title="No contracts yet"
                description="Add the agreements you have with customers. A contract says how its buildings are billed."
                action={
                  canWrite ? (
                    <Button size="sm" onClick={() => setEditing("new")}>
                      New contract
                    </Button>
                  ) : null
                }
              />
            )
          }
        />

        {contracts.data && contracts.data.total > 0 ? (
          <Pagination
            page={contracts.data.page}
            pageSize={contracts.data.page_size}
            total={contracts.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="contracts"
          />
        ) : null}
      </Panel>

      <ContractSheet
        target={editing}
        defaultCustomerId={customerId}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
