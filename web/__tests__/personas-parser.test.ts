import { describe, it, expect } from "vitest";
import {
  parsePersona,
  serializePersona,
  shortDescription,
} from "@/lib/personas/parser";

describe("parsePersona", () => {
  it("returns empty frontmatter when no fence is present", () => {
    const { frontmatter, body } = parsePersona("# Title\n\nBody text.");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Title\n\nBody text.");
  });

  it("parses inline lists", () => {
    const raw = [
      "---",
      "slug: alice",
      "tags: [voice, support, fr]",
      "---",
      "Hello",
    ].join("\n");
    const { frontmatter, body } = parsePersona(raw);
    expect(frontmatter.slug).toBe("alice");
    expect(frontmatter.tags).toEqual(["voice", "support", "fr"]);
    expect(body).toBe("Hello");
  });

  it("parses block lists", () => {
    const raw = [
      "---",
      "n8n_bindings_suggested:",
      "  - send_email",
      "  - create_ticket",
      "language: fr",
      "---",
      "body",
    ].join("\n");
    const { frontmatter } = parsePersona(raw);
    expect(frontmatter.n8n_bindings_suggested).toEqual([
      "send_email",
      "create_ticket",
    ]);
    expect(frontmatter.language).toBe("fr");
  });

  it("coerces scalar types (boolean, number, string)", () => {
    const raw = [
      "---",
      "max_call_duration_secs: 600",
      "enabled: true",
      "ratio: 1.5",
      "title: Alice (FR)",
      "---",
      "",
    ].join("\n");
    const { frontmatter } = parsePersona(raw);
    expect(frontmatter.max_call_duration_secs).toBe(600);
    expect(frontmatter.enabled).toBe(true);
    expect(frontmatter.ratio).toBe(1.5);
    expect(frontmatter.title).toBe("Alice (FR)");
  });

  it("preserves the markdown body verbatim", () => {
    const raw = [
      "---",
      "slug: bob",
      "---",
      "",
      "# Heading",
      "",
      "Paragraph with **bold** and a [link](https://example.com).",
      "",
      "- bullet",
    ].join("\n");
    const { body } = parsePersona(raw);
    expect(body).toContain("# Heading");
    expect(body).toContain("**bold**");
    expect(body).toContain("- bullet");
  });

  it("handles CRLF line endings", () => {
    const raw = "---\r\nslug: bob\r\n---\r\nbody\r\n";
    const { frontmatter, body } = parsePersona(raw);
    expect(frontmatter.slug).toBe("bob");
    expect(body.trim()).toBe("body");
  });

  it("returns empty frontmatter when the closing fence is missing", () => {
    const raw = "---\nslug: bob\nno fence here\n";
    const { frontmatter } = parsePersona(raw);
    expect(frontmatter).toEqual({});
  });
});

describe("serializePersona round-trip", () => {
  it("round-trips an inline list", () => {
    const original = {
      frontmatter: { slug: "alice", tags: ["a", "b", "c"] },
      body: "Some body content.",
    };
    const out = serializePersona(original);
    const reparsed = parsePersona(out);
    expect(reparsed.frontmatter.slug).toBe("alice");
    expect(reparsed.frontmatter.tags).toEqual(["a", "b", "c"]);
    expect(reparsed.body).toBe("Some body content.");
  });

  it("emits a block list for entries with spaces", () => {
    const original = {
      frontmatter: { tags: ["voice ai", "fr support"] },
      body: "",
    };
    const out = serializePersona(original);
    expect(out).toContain("tags:");
    expect(out).toContain("  - voice ai");
    const reparsed = parsePersona(out);
    expect(reparsed.frontmatter.tags).toEqual(["voice ai", "fr support"]);
  });

  it("round-trips scalars including booleans and numbers", () => {
    const original = {
      frontmatter: { slug: "x", enabled: true, max: 42 },
      body: "hello",
    };
    const reparsed = parsePersona(serializePersona(original));
    expect(reparsed.frontmatter.slug).toBe("x");
    expect(reparsed.frontmatter.enabled).toBe(true);
    expect(reparsed.frontmatter.max).toBe(42);
    expect(reparsed.body).toBe("hello");
  });
});

describe("shortDescription", () => {
  it("strips markdown headings and collapses whitespace", () => {
    const body = "# Title\n\nFirst paragraph.\n\n## Sub\n\nSecond paragraph.";
    expect(shortDescription(body)).toBe("First paragraph. Second paragraph.");
  });

  it("truncates with ellipsis at word boundary", () => {
    const body = "word ".repeat(80);
    const out = shortDescription(body, 30);
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out.endsWith("…")).toBe(true);
  });
});
