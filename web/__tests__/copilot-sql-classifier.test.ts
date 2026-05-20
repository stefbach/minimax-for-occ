import { describe, it, expect } from "vitest";
import { classifySql } from "@/lib/copilot/tools";

/**
 * Sprint 1 fixed the classifier to:
 *  - run case-insensitively (regex /i flag)
 *  - strip `-- line` and `/* block *\/` comments before classification
 *
 * These tests lock that behavior in so a future refactor can't regress
 * the safety story for the Super Admin Copilot.
 */
describe("classifySql", () => {
  it("classifies a plain SELECT as read", () => {
    expect(classifySql("SELECT * FROM agents").kind).toBe("read");
  });

  it("classifies INSERT … as write", () => {
    expect(classifySql("INSERT INTO agents (id) VALUES ('x')").kind).toBe("write");
  });

  it("classifies an UPDATE as write", () => {
    expect(classifySql("UPDATE agents SET name = 'x'").kind).toBe("write");
  });

  it("flags DROP TABLE as dangerous", () => {
    const c = classifySql("DROP TABLE agents");
    expect(c.kind).toBe("dangerous");
    expect(c.reason).toContain("destructive");
  });

  it("flags TRUNCATE as dangerous", () => {
    expect(classifySql("TRUNCATE TABLE agents").kind).toBe("dangerous");
  });

  it("is case-insensitive for dangerous keywords (Sprint 1 fix)", () => {
    expect(classifySql("dRoP table agents").kind).toBe("dangerous");
    expect(classifySql("drop TABLE agents").kind).toBe("dangerous");
    expect(classifySql("DELETE FROM agents").kind).toBe("dangerous");
  });

  it("ignores keywords hidden inside line comments (Sprint 1 fix)", () => {
    // A bare comment should NOT make it dangerous.
    const benign = classifySql("-- DROP TABLE evil\nSELECT 1");
    expect(benign.kind).toBe("read");
  });

  it("still flags real DROP when preceded by a line comment", () => {
    const dangerous = classifySql("-- harmless comment\nDROP TABLE agents");
    expect(dangerous.kind).toBe("dangerous");
  });

  it("ignores keywords inside block comments", () => {
    const benign = classifySql("/* DROP TABLE evil */ SELECT 1");
    expect(benign.kind).toBe("read");
  });

  it("flags GRANT / REVOKE / CREATE ROLE as dangerous", () => {
    expect(classifySql("GRANT SELECT ON agents TO public").kind).toBe("dangerous");
    expect(classifySql("REVOKE INSERT ON agents FROM anon").kind).toBe("dangerous");
    expect(classifySql("CREATE ROLE mallory").kind).toBe("dangerous");
  });

  it("treats CREATE TABLE / ALTER as write or dangerous (ALTER is dangerous)", () => {
    // ALTER matches dangerous list
    expect(classifySql("ALTER TABLE agents ADD COLUMN x int").kind).toBe("dangerous");
    // CREATE TABLE is a write
    expect(classifySql("CREATE TABLE foo (id int)").kind).toBe("write");
  });
});
