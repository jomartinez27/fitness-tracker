import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { InMemoryRepository } from "@/lib/repository/in-memory";
import { RepositoryContext } from "@/lib/repository/provider";
import type { Repository } from "@/lib/repository/repository";
import { ACTIVE_DRAFT_ID } from "@/lib/entry-form/use-entry-draft";
import { EntryFlow } from "./entry-flow";

function renderFlow(repository: Repository) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <RepositoryContext.Provider value={{ repository, status: "persistent" }}>
        <EntryFlow />
      </RepositoryContext.Provider>
    </NextIntlClientProvider>,
  );
}

/** Fills step 1 and step 2 and lands on the review step. */
async function fillToReview(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Activity"), "Morning run");
  await user.type(screen.getByLabelText("Date"), "2026-07-20");
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.type(await screen.findByLabelText("Duration"), "42");
  await user.type(screen.getByLabelText("Distance"), "8.2");
  await user.click(screen.getByRole("button", { name: "Next" }));
}

describe("EntryFlow — validation", () => {
  it("blocks the step and explains why", async () => {
    const user = userEvent.setup();
    renderFlow(new InMemoryRepository());

    await user.click(await screen.findByRole("button", { name: "Next" }));

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(/Give the session a name/),
    ).toBeInTheDocument();
    // Still on step 1 — the summary is not a substitute for actually stopping.
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("moves focus to the error summary so it is not silently announced", async () => {
    const user = userEvent.setup();
    renderFlow(new InMemoryRepository());

    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
  });

  it("marks the offending field invalid and describes it", async () => {
    const user = userEvent.setup();
    renderFlow(new InMemoryRepository());

    await user.click(await screen.findByRole("button", { name: "Next" }));

    const activity = screen.getByLabelText("Activity");
    expect(activity).toHaveAttribute("aria-invalid", "true");
    expect(activity).toHaveAccessibleDescription(/Give the session a name/);
  });
});

describe("EntryFlow — no data loss", () => {
  it("restores what was typed after the component is unmounted and remounted", async () => {
    // This is back-navigation: the user taps Back, the tree unmounts, they
    // return. Nothing they typed may be gone.
    const repository = new InMemoryRepository();
    const user = userEvent.setup();

    const first = renderFlow(repository);
    await user.type(await screen.findByLabelText("Activity"), "Evening swim");
    await user.type(screen.getByLabelText("Date"), "2026-07-19");
    first.unmount();

    renderFlow(repository);
    expect(await screen.findByLabelText("Activity")).toHaveValue("Evening swim");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-07-19");
  });

  it("flushes the pending autosave on unmount rather than losing the last keystrokes", async () => {
    // The debounce is the trap: type, immediately navigate away, and a naive
    // implementation drops everything typed inside the debounce window.
    const repository = new InMemoryRepository();
    const saveDraft = vi.spyOn(repository, "saveDraft");
    const user = userEvent.setup();

    const view = renderFlow(repository);
    await user.type(await screen.findByLabelText("Activity"), "Yoga");
    saveDraft.mockClear();
    view.unmount();

    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
    expect(saveDraft.mock.calls.at(-1)?.[0].values.activity).toBe("Yoga");
  });

  it("remembers which step the user was on", async () => {
    const repository = new InMemoryRepository();
    const user = userEvent.setup();

    const first = renderFlow(repository);
    await user.type(await screen.findByLabelText("Activity"), "Run");
    await user.type(screen.getByLabelText("Date"), "2026-07-20");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByLabelText("Duration");
    first.unmount();

    renderFlow(repository);
    expect(await screen.findByText("Step 2 of 3")).toBeInTheDocument();
  });

  it("tells the user their work was recovered", async () => {
    const repository = new InMemoryRepository();
    await repository.saveDraft({
      id: ACTIVE_DRAFT_ID,
      step: 0,
      values: {
        activity: "Interrupted run",
        date: "",
        durationMin: "",
        distanceKm: "",
        notes: "",
      },
      updatedAt: Date.now(),
    });

    renderFlow(repository);
    expect(
      await screen.findByText(/restored your unsaved session/),
    ).toBeInTheDocument();
  });
});

describe("EntryFlow — submit", () => {
  it("saves the session and confirms it", async () => {
    const repository = new InMemoryRepository();
    const user = userEvent.setup();
    renderFlow(repository);

    await fillToReview(user);
    await user.click(await screen.findByRole("button", { name: "Save session" }));

    expect(await screen.findByText("Session saved")).toBeInTheDocument();
    const saved = await repository.listEntries({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      activity: "Morning run",
      durationMin: 42,
      distanceKm: 8.2,
      source: "manual",
    });
  });

  it("clears the draft in the same operation that saves the entry", async () => {
    // Risk R3: if the draft outlives the commit, returning to the form restores
    // a session the user already logged — and they log it twice.
    const repository = new InMemoryRepository();
    const user = userEvent.setup();
    renderFlow(repository);

    await fillToReview(user);
    await user.click(await screen.findByRole("button", { name: "Save session" }));
    await screen.findByText("Session saved");

    expect(await repository.loadDraft(ACTIVE_DRAFT_ID)).toBeNull();
  });

  it("does not let a pending autosave resurrect the draft after saving", async () => {
    // The subtle half of R3, and the one atomicity cannot fix: clicking through
    // to the review step schedules a debounced write. Commit deletes the draft,
    // then that write lands and puts it straight back — so the next visit
    // offers to restore a session that was already saved.
    const repository = new InMemoryRepository();
    const user = userEvent.setup();
    renderFlow(repository);

    await fillToReview(user);
    await user.click(await screen.findByRole("button", { name: "Save session" }));
    await screen.findByText("Session saved");

    // Wait past the autosave debounce — checking immediately passes either way.
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(await repository.loadDraft(ACTIVE_DRAFT_ID)).toBeNull();
  });

  it("cannot write two entries from a double-tap", async () => {
    const repository = new InMemoryRepository();
    const commit = vi.spyOn(repository, "commitDraft");
    const user = userEvent.setup();
    renderFlow(repository);

    await fillToReview(user);
    const save = await screen.findByRole("button", { name: "Save session" });
    await user.dblClick(save);

    await screen.findByText("Session saved");
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("offers a retry that keeps the input when the save fails", async () => {
    const repository = new InMemoryRepository();
    const commit = vi
      .spyOn(repository, "commitDraft")
      .mockRejectedValueOnce(new Error("storage went away"));
    const user = userEvent.setup();
    renderFlow(repository);

    await fillToReview(user);
    await user.click(await screen.findByRole("button", { name: "Save session" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/Couldn't save that session/)).toBeInTheDocument();
    // The user's work is still on screen — a failed save must not also lose it.
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();

    commit.mockRestore();
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Session saved")).toBeInTheDocument();
  });

  it("jumps back to the step holding the first problem", async () => {
    // Not reachable by clicking Next — per-step validation already stops that.
    // It is reachable by restoring a draft: storage outlives deploys, so a
    // draft saved on the review step can carry values an earlier step would
    // now reject. Submitting must land the user where the error actually is,
    // not strand them on a step showing no error at all.
    const repository = new InMemoryRepository();
    await repository.saveDraft({
      id: ACTIVE_DRAFT_ID,
      step: 2,
      values: {
        activity: "Run",
        date: "2026-07-20",
        durationMin: "", // invalid, and owned by step 2 of 3
        distanceKm: "",
        notes: "",
      },
      updatedAt: Date.now(),
    });

    const user = userEvent.setup();
    renderFlow(repository);

    await user.click(await screen.findByRole("button", { name: "Save session" }));

    expect(await screen.findByText("Step 2 of 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Duration")).toHaveAttribute("aria-invalid", "true");
  });
});
