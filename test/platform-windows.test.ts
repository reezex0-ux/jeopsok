import { describe, expect, it } from "vitest";

import { defaultShellForPlatform } from "../src/config.js";
import { shellCommandArgs } from "../src/exec-tools.js";

describe("Windows native execution helpers", () => {
  it("selects PowerShell by default on Windows and preserves explicit overrides", () => {
    expect(defaultShellForPlatform({}, "win32")).toBe("powershell.exe");
    expect(defaultShellForPlatform({ SHELL: "/bin/zsh" }, "linux")).toBe("/bin/zsh");
    expect(defaultShellForPlatform({ MCP_DEFAULT_SHELL: "pwsh.exe" }, "win32")).toBe("pwsh.exe");
  });

  it("builds shell-specific command arguments", () => {
    expect(shellCommandArgs("powershell.exe", "Get-Process", true)).toEqual([
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Get-Process",
    ]);
    expect(shellCommandArgs("C:\\Program Files\\PowerShell\\7\\pwsh.exe", "Get-Date", false)).toEqual([
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Get-Date",
    ]);
    expect(shellCommandArgs("cmd.exe", "ver", true)).toEqual(["/d", "/s", "/c", "ver"]);
    expect(shellCommandArgs("/bin/bash", "pwd", true)).toEqual(["-lc", "pwd"]);
    expect(shellCommandArgs("/bin/sh", "pwd", false)).toEqual(["-c", "pwd"]);
  });

});
