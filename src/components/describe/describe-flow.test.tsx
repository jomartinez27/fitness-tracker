import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { InMemoryRepository } from "@/lib/repository/in-memory";
import { RepositoryContext } from "@/lib/repository/provider";
import type { Repository } from "@/lib/repository/repository";
import type { ExtractEvent } from "@/lib/ai/protocol";

const streamExtraction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/client")>()),
  streamExtraction,
}));

const { ExtractRequestError } = await import("@/lib/ai/client");
const { DescribeFlow } = await import("./describe-flow");

function renderFlow(repository: Repository = new InMemoryRepository()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <RepositoryContext.Provider value={{ repository, status: "persistent" }}>
        <DescribeFlow />
      </RepositoryContext.Provider>
    </NextIntlClientProvider>,
  );
  return repository;
}

async function* yields(...events: ExtractEvent[]) {
  for (const event of events) yield event;
}

const RUN = {
  activity: "Run",
  date: "2026-07-28",
  durationMin: 28,
  distanceKm: 5,
  inferred: ["durationMin" as const],
};
const YOGA = {
  activity: "Yoga",
  date: "2026-07-28",
  durationMin: 30,
  inferred: [],
};

async function extract(user: ReturnType<typeof userEvent.setup>, text = "ran 5k") {
  await user.type(screen.getByLabelText("What did you do?"), text);
  await user.click(screen.getByRole("button", { name: "Extract sessions" }));
}

beforeEach(() => streamExtraction.mockReset());

describe("DescribeFlow — the streaming surface", () => {
  it("renders prose as it arrives, with no spinner", async () => {
    // The streaming IS the loading affordance (ADR-0003).
    streamExtraction.mockReturnValue(
      yields(
        { type: "summary_delta", text: "Logged a " },
        { type: "summary_delta", text: "5 km run." },
        { type: "entries", entries: [RUN], source: "ai" },
      ),
    );
    const user = userEvent.setup();
    renderFlow();
    await extract(user);

    expect(await screen.findByText("Logged a 5 km run.")).toBeInTheDocument();
  });

  it("announces only the moments that matter, not every token", async () => {
    // Piping token-by-token text into a live region makes a screen reader
    // unusable, so the visible prose sits outside it.
    streamExtraction.mockReturnValue(
      yields(
        { type: "summary_delta", text: "Logged a 5 km run." },
        { type: "entries", entries: [RUN], source: "ai" },
      ),
    );
    const user = userEvent.setup();
    renderFlow();
    await extract(user);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Found one session");
    expect(status).not.toHaveTextContent("Logged a 5 km run.");
  });

  it("requires text before it will run", async () => {
    renderFlow();
    expect(screen.getByRole("button", { name: "Extract sessions" })).toBeDisabled();
  });
});

describe("DescribeFlow — proposals", () => {
  it("shows sessions for review rather than saving them", async () => {
    streamExtraction.mockReturnValue(
      yields({ type: "entries", entries: [RUN, YOGA], source: "ai" }),
    );
    const user = userEvent.setup();
    const repository = renderFlow();
    await extract(user);

    // Scoped to the heading: the same text is also in the live region, which
    // announces the outcome. The heading is for navigation, the region for
    // notification — both should exist.
    expect(
      await screen.findByRole("heading", { name: "Found 2 sessions" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing is saved until you say so/i)).toBeInTheDocument();
    // Nothing written yet.
    expect(await repository.listEntries({ from: "2026-01-01", to: "2026-12-31" })).toHaveLength(0);
  });

  it("marks an inferred value so a guess is not mistaken for a measurement", async () => {
    streamExtraction.mockReturnValue(
      yields({ type: "entries", entries: [RUN], source: "ai" }),
    );
    const user = userEvent.setup();
    renderFlow();
    await extract(user);

    const item = await screen.findByRole("listitem");
    // Duration was derived from the distance; the distance was stated.
    expect(within(item).getByText("estimated")).toBeInTheDocument();
    expect(within(item).getByText(/worked this out rather than reading it/i)).toBeInTheDocument();
  });

  it("does not mark values the user actually stated", async () => {
    streamExtraction.mockReturnValue(
      yields({ type: "entries", entries: [YOGA], source: "ai" }),
    );
    const user = userEvent.setup();
    renderFlow();
    await extract(user, "30 min yoga today");

    const item = await screen.findByRole("listitem");
    expect(within(item).queryByText("estimated")).not.toBeInTheDocument();
  });

  it("treats no sessions found as guidance, not an error", async () => {
    streamExtraction.mockReturnValue(
      yields({ type: "entries", entries: [], source: "ai" }),
    );
    const user = userEvent.setup();
    renderFlow();
    await extract(user, "rest day");

    expect(await screen.findByText(/couldn't find any sessions/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("DescribeFlow — the fallback is a labelled success", () => {
  it("says the entries were parsed locally, without calling it an error", async () => {
    streamExtraction.mockReturnValue(
      yields({ type: "entries", entries: [RUN], source: "ai-fallback" }),
    );
    const user = userEvent.setup();
    renderFlow();
    await extract(user);

    expect(await screen.findByText("Parsed on your device")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Still fully usable.
    expect(screen.getByRole("button", { name: /Save 1 session/ })).toBeEnabled();
  });

  it("does not label a genuine model result", async () => {
    streamExtraction.mockReturnValue(
      yields({ type: "entries", entries: [RUN], source: "ai" }),
    );
    const user = userEvent.setup();
    renderFlow();
    await extract(user);

    await screen.findByRole("listitem");
    expect(screen.queryByText("Parsed on your device")).not.toBeInTheDocument();
  });
});

describe("DescribeFlow — errors and retry", () => {
  it("explains a rate limit and says when to come back", async () => {
    streamExtraction.mockImplementation(async function* () {
      throw new ExtractRequestError("rate_limited", 12);
    });
    const user = userEvent.setup();
    renderFlow();
    await extract(user);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/That's a lot of requests/)).toBeInTheDocument();
    expect(within(alert).getByText(/about 12 seconds/)).toBeInTheDocument();
  });

  it("moves focus to the error so it is not announced into the void", async () => {
    streamExtraction.mockImplementation(async function* () {
      throw new ExtractRequestError("network");
    });
    const user = userEvent.setup();
    renderFlow();
    await extract(user);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
  });

  it("retries with the text intact", async () => {
    streamExtraction
      .mockImplementationOnce(async function* () {
        throw new ExtractRequestError("network");
      })
      .mockImplementationOnce(() => yields({ type: "entries", entries: [RUN], source: "ai" }));

    const user = userEvent.setup();
    renderFlow();
    await extract(user);

    const alert = await screen.findByRole("alert");
    // The user's words are still there — a failed request must not eat them.
    expect(screen.getByLabelText("What did you do?")).toHaveValue("ran 5k");

    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("listitem")).toBeInTheDocument();
  });
});

describe("DescribeFlow — saving", () => {
  it("saves only the sessions still ticked", async () => {
    streamExtraction.mockReturnValue(
      yields({ type: "entries", entries: [RUN, YOGA], source: "ai" }),
    );
    const user = userEvent.setup();
    const repository = renderFlow();
    await extract(user);

    const items = await screen.findAllByRole("listitem");
    await user.click(within(items[1]).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /Save 1 session/ }));

    expect(await screen.findByText("1 session saved")).toBeInTheDocument();
    const saved = await repository.listEntries({ from: "2026-01-01", to: "2026-12-31" });
    expect(saved).toHaveLength(1);
    expect(saved[0].activity).toBe("Run");
  });

  it("records where the entry came from, so AI data is never disguised", async () => {
    streamExtraction.mockReturnValue(
      yields({ type: "entries", entries: [RUN], source: "ai-fallback" }),
    );
    const user = userEvent.setup();
    const repository = renderFlow();
    await extract(user);

    await user.click(await screen.findByRole("button", { name: /Save 1 session/ }));
    await screen.findByText("1 session saved");

    const saved = await repository.listEntries({ from: "2026-01-01", to: "2026-12-31" });
    expect(saved[0].source).toBe("ai-fallback");
  });

  it("keeps the proposals when the save fails", async () => {
    const repository = new InMemoryRepository();
    vi.spyOn(repository, "createEntry").mockRejectedValueOnce(new Error("disk gone"));
    streamExtraction.mockReturnValue(
      yields({ type: "entries", entries: [RUN], source: "ai" }),
    );

    const user = userEvent.setup();
    renderFlow(repository);
    await extract(user);
    await user.click(await screen.findByRole("button", { name: /Save 1 session/ }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/Couldn't save those sessions/)).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toBeInTheDocument();
  });

  it("cannot save nothing", async () => {
    streamExtraction.mockReturnValue(
      yields({ type: "entries", entries: [RUN], source: "ai" }),
    );
    const user = userEvent.setup();
    renderFlow();
    await extract(user);

    await user.click(within(await screen.findByRole("listitem")).getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /Save 0 sessions/ })).toBeDisabled();
  });
});
