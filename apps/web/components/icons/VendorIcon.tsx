"use client";

import * as React from "react";
import { HelpCircle } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { lookupVendor, type VendorEntry } from "@/lib/icons/catalog";

interface VendorIconProps {
  id: string;
  size?: number;
  className?: string;
  /** Override the colour the icon glyph is rendered in. */
  color?: string;
}

export function VendorIcon({ id, size = 14, className, color }: VendorIconProps) {
  const entry = lookupVendor(id);
  if (!entry) {
    return (
      <HelpCircle
        className={className}
        style={{ width: size, height: size, color: color ?? "currentColor" }}
      />
    );
  }
  return (
    <VendorIconInner entry={entry} size={size} className={className} color={color} />
  );
}

export function VendorIconInner({
  entry,
  size = 14,
  className,
  color,
}: {
  entry: VendorEntry;
  size?: number;
  className?: string;
  color?: string;
}) {
  const tint = color ?? entry.color;
  if (entry.renderer.kind === "simple") {
    const Component = entry.renderer.component;
    return (
      <Component
        color={tint}
        size={size}
        title={entry.label}
        className={className}
      />
    );
  }
  const Component = entry.renderer.component;
  return (
    <Component
      className={cn(className)}
      style={{ width: size, height: size, color: tint }}
      aria-label={entry.label}
    />
  );
}

interface VendorBadgeProps {
  id: string;
  size?: number;
  className?: string;
}

/**
 * Vendor icon inside a chunky pill — designed to look like an applied
 * "sticker" on a chassis. Pill is white with a brand-coloured ring so the
 * logo reads clearly against any node accent color.
 */
export function VendorBadge({ id, size = 20, className }: VendorBadgeProps) {
  const entry = lookupVendor(id);
  if (!entry) return null;
  const pillSize = size + 10;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-white shadow-md ring-2",
        className,
      )}
      style={{
        width: pillSize,
        height: pillSize,
        // ring color is the brand color at ~70% so it's clearly identifiable
        ["--tw-ring-color" as string]: entry.color + "B3",
      }}
      title={entry.label}
    >
      <VendorIconInner entry={entry} size={size} />
    </span>
  );
}
