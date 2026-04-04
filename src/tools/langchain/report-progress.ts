/**
 * LangChain version of the reportProgress tool.
 *
 * The gateway event adapter maps `on_tool_end` for this tool to a
 * `YagrUserVisibleUpdate`.  The tool itself simply echoes the message so
 * the model receives confirmation and the event stream carries the update.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const reportProgressTool = tool(
  async ({ message }): Promise<string> => {
    return JSON.stringify({ delivered: true, message });
  },
  {
    name: 'reportProgress',
    description:
      'Send a short user-visible progress update. Use this for concise action-oriented status messages before or during substantial work. Do not expose private reasoning.',
    schema: z.object({
      message: z.string().min(1).describe('Short user-visible progress update.'),
    }),
  },
);
