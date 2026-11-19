"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MAX_SHORTS, PACKAGES, slotsFor } from "@convex/lib/packages";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

import { KindIcon } from "./slot-status";
import { PickList } from "@/components/ui/pick-list";

/**
 * Starting a project: a name, the package that lays out its slots, and who it is for. Its
 * own page, like New automation, with the slots it will have listed as the package changes.
 */
export function NewProjectView({ clientId }: { clientId?: string }) {
  const team = useActiveTeam();
  const router = useRouter();
  const create = useMutation(api.projects.create);
  const clients = useQuery(api.clients.list, { organizationId: team.id });
  const [name, setName] = useState("");
  const [packageId, setPackageId] = useState(PACKAGES[0].id);
  const picked = PACKAGES.find((entry) => entry.id === packageId) ?? PACKAGES[0];
  const [shorts, setShorts] = useState<string>(String(picked.shorts ?? ""));
  const [client, setClient] = useState(clientId ?? "");
  const [pending, setPending] = useState(false);

  const count = Number.parseInt(shorts, 10);
  const slots = slotsFor(packageId, Number.isFinite(count) ? count : undefined);

  function onPickPackage(id: string) {
    setPackageId(id);
    const next = PACKAGES.find((entry) => entry.id === id);
    setShorts(String(next?.shorts ?? ""));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const id = await create({
        organizationId: team.id,
        name,
        package: packageId,
        ...(picked.shorts !== null && Number.isFinite(count) ? { shorts: count } : {}),
        ...(client ? { clientId: client as Id<"clients"> } : {}),
      });
      router.replace(`/projects/${id}`, { transitionTypes: ["nav-forward"] });
    } catch (caught) {
      toast.error(errorMessage(caught, "The project could not be made. Try again."));
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="-ml-2">
          <Link href="/projects" transitionTypes={["nav-back"]}>
            <ArrowLeft />
            <span className="sr-only">Back to projects</span>
          </Link>
        </Button>
        <div className="grid">
          <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
          <p className="text-muted-foreground text-sm">
            Pick what it delivers. Every slot can be renamed, added or removed later.
          </p>
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,36rem)_18rem]"
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="project-name">Name</FieldLabel>
            <Input
              id="project-name"
              value={name}
              maxLength={120}
              placeholder="Episode 42"
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Package</legend>
            {PACKAGES.map((entry) => (
              <label
                key={entry.id}
                className="choice-tile has-focus-visible:ring-ring/50 flex cursor-pointer items-start gap-3 rounded-xl p-3 has-focus-visible:ring-3"
              >
                <input
                  type="radio"
                  name="package"
                  value={entry.id}
                  checked={entry.id === packageId}
                  onChange={() => onPickPackage(entry.id)}
                  className="accent-foreground mt-1"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{entry.name}</span>
                  <span className="text-muted-foreground text-sm">{entry.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {picked.shorts !== null && (
            <Field>
              <FieldLabel htmlFor="project-shorts">Shorts</FieldLabel>
              <Input
                id="project-shorts"
                type="number"
                min={0}
                max={MAX_SHORTS}
                value={shorts}
                onChange={(event) => setShorts(event.target.value)}
                className="w-24"
              />
              <FieldDescription>Up to {MAX_SHORTS}.</FieldDescription>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="project-client">For</FieldLabel>
            <PickList
              id="project-client"
              className="w-64"
              value={client}
              onChange={setClient}
              options={[
                { value: "", label: "Your team" },
                ...(clients ?? []).map((entry) => ({ value: entry._id, label: entry.name })),
              ]}
            />
            <FieldDescription>
              A client&apos;s project uses its brand and shows in its space.{" "}
              <Link href="/clients" className="underline underline-offset-2">
                Clients
              </Link>
            </FieldDescription>
          </Field>

          <div>
            <Button type="submit" disabled={pending || !name.trim()}>
              Make project
            </Button>
          </div>
        </FieldGroup>

        <section aria-label="Slots it will have" className="flex flex-col gap-2">
          <h2 className="flex items-baseline gap-2 text-sm font-semibold">
            Slots
            <span className="text-muted-foreground font-normal tabular-nums">{slots.length}</span>
          </h2>
          {slots.length === 0 ? (
            <p className="text-muted-foreground text-sm">None yet. Add them on the project.</p>
          ) : (
            <ul className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto">
              {slots.map((slot) => (
                <li key={slot.label} className="flex items-center gap-2 py-1 text-sm">
                  <KindIcon kind={slot.kind} />
                  {slot.label}
                </li>
              ))}
            </ul>
          )}
        </section>
      </form>
    </>
  );
}
