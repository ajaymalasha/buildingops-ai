import { $api } from "@/lib/api/client";

/**
 * The request for one work order with its history.
 *
 * The drawer reads it. The form, when it saves a change, puts the work order the API sent
 * back under the same key, so the drawer shows it changed the moment it reappears.
 */
export function workOrderQuery(workOrderId: string) {
  return $api.queryOptions("get", "/api/v1/work-orders/{work_order_id}", {
    params: { path: { work_order_id: workOrderId } },
  });
}
