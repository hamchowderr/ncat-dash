import { z } from "zod";
import { defineStep } from "../../define";

export const codeExecutePython = defineStep({
  id: "code-execute-python",
  category: "code",
  title: "Run Python",
  description:
    "Executes Python code on the server in a controlled environment. Useful for scripting, data processing, or dynamic automation workflows.",
  endpoint: "/v1/code/execute/python",
  method: "POST",
  output: "json",
  primaryInput: null,
  input: z.object({
    code: z.string().describe("Python code to execute"),
    webhook_url: z.string().url().optional(),
    id: z.string().optional(),
  }),
});
