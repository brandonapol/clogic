import type { ToolDefinition } from './types.js'

export const getLoudnessTool: ToolDefinition = {
  name: 'get_loudness',
  description:
    'Measures the loudness of a bounced audio file on disk using the EBU R128 / ITU-R BS.1770 ' +
    'method. Returns integrated loudness in LUFS, loudness range in LU, and true peak in dBTP. ' +
    'Use it when the user asks how loud a mix or stem is, or whether it meets a streaming ' +
    'loudness target. It reads the file only and never changes it. It does not analyse ' +
    'frequency balance, stereo width or dynamics per section.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to a WAV, AIFF or other ffmpeg-readable audio file.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
}
