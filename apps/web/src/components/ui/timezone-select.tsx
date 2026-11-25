"use client";

import { useMemo } from "react";

import { groupedTimeZones, timeZoneLabel } from "@/lib/regional";

import { Select } from "./input";

type Props = Omit<React.ComponentProps<"select">, "children"> & {
  /** The saved value, kept in the list even if this browser does not know the zone. */
  current?: string;
};

export function TimeZoneSelect({ current, ...props }: Props) {
  const groups = useMemo(() => groupedTimeZones(current), [current]);
  return (
    <Select {...props}>
      {groups.map(([region, zones]) => (
        <optgroup key={region} label={region}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {timeZoneLabel(zone)}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
