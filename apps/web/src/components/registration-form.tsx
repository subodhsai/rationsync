"use client";

import { KARNATAKA_DISTRICTS, type ShopApplication, type WarehouseOption } from "@rationsync/shared";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Field, SelectField, TextareaField } from "@/components/field";
import { FormStatus, useFormAction } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import { submitRegistration } from "@/lib/shop-actions";

export function RegistrationForm({
  warehouses,
  defaults,
}: {
  warehouses: WarehouseOption[];
  defaults: ShopApplication | null;
}) {
  const { state, onSubmit, pending, errorFor } = useFormAction(submitRegistration);
  const [district, setDistrict] = useState(defaults?.district ?? "");
  // Warehouses in the chosen district come first.
  const sorted = [...warehouses].sort((a, b) => Number(b.district === district) - Number(a.district === district));

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      <FormStatus state={state} />

      <fieldset className="space-y-5">
        <legend className="mb-4 text-lg font-semibold">Shop</legend>
        <Field
          id="fpsId"
          label="FPS ID"
          defaultValue={defaults?.fpsId}
          autoComplete="off"
          spellCheck={false}
          className="font-mono uppercase"
          hint="As printed on your Fair Price Shop licence. Letters, digits and hyphens."
          error={errorFor("fpsId")}
        />
        <Field id="name" label="Shop name" defaultValue={defaults?.name} error={errorFor("name")} />
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="mb-4 text-lg font-semibold">Location</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            id="district"
            label="District"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            error={errorFor("district")}
          >
            <option value="">Choose a district</option>
            {KARNATAKA_DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </SelectField>
          <Field id="taluk" label="Taluk" defaultValue={defaults?.taluk} error={errorFor("taluk")} />
        </div>
        <TextareaField
          id="address"
          label="Shop address"
          defaultValue={defaults?.address}
          rows={3}
          autoComplete="street-address"
          error={errorFor("address")}
        />
        <Field
          id="pinCode"
          label="PIN code"
          defaultValue={defaults?.pinCode ?? undefined}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          className="max-w-40 tabular-nums"
          error={errorFor("pinCode")}
        />
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="mb-4 text-lg font-semibold">Contact</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="contactPhone"
            label="Phone"
            type="tel"
            defaultValue={defaults?.contactPhone}
            autoComplete="tel"
            hint="Mobile, or landline with STD code"
            error={errorFor("contactPhone")}
          />
          <Field
            id="contactEmail"
            label="Email"
            type="email"
            optional
            defaultValue={defaults?.contactEmail ?? undefined}
            autoComplete="email"
            error={errorFor("contactEmail")}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="mb-4 text-lg font-semibold">Supplying warehouse</legend>
        <SelectField
          id="warehouseId"
          label="Warehouse"
          defaultValue={defaults?.warehouse.id ?? ""}
          hint="An administrator at this warehouse reviews your application."
          error={errorFor("warehouseId")}
        >
          <option value="">Choose a warehouse</option>
          {sorted.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.district})
            </option>
          ))}
        </SelectField>
      </fieldset>

      <div className="space-y-3 border-t border-border pt-6">
        <p className="text-[0.875rem] text-muted-foreground">
          This is an application to use RationSync. It is not a government licence and does not change your official
          FPS authorisation.
        </p>
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {defaults ? "Resubmit application" : "Submit application"}
        </Button>
      </div>
    </form>
  );
}
