import FastifyCors from "@fastify/cors";
import fastify from "fastify";
import { pipeline } from "node:stream";
import util from "node:util";
import fastq, { type queueAsPromised } from "fastq";
import FastifyMultipart from "@fastify/multipart";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import mime from "mime-types";
import { $ } from "zx";

// Util for the @fastify/multipart
const pump = util.promisify(pipeline);

interface IWhisperTask {
  fileName: string;
  language: string;
}

// To control the tasks that are still running, fastqueue ignore the running ones
let taskQueue: string[] = [];

const whisperQueue: queueAsPromised<IWhisperTask> = fastq.promise(
  whisperTranscribeWorker,
  1
);

const FILE_DIR = path.join(__dirname, "./files");
$.cwd = FILE_DIR;

// const WHISPER_PATH = "/home/palhari/workspace/stt/my-venv/bin/whisper";
const WHISPER_PATH = "whisper";

async function whisperTranscribeWorker(arg: IWhisperTask) {
  const { fileName, language } = arg;

  const result =
    await $`${WHISPER_PATH} ${fileName} --language ${language} --output_format txt`;
  console.log(`[${fileName} - ${language}]`, result);

  // Delete the audio file
  await $`rm ${fileName}`;

  taskQueue = taskQueue.filter((t) => t !== fileName);
}

const app = fastify();

async function run() {
  await app.register(FastifyCors);
  await app.register(FastifyMultipart);

  app.post("/transcribe", async function (req, reply) {
    const data = await req.file();

    if (!data) throw new Error(`File is required!`);

    const fileId = nanoid();
    const fileExtension = mime.extension(data.mimetype);
    const fileName = `${fileId}.${fileExtension}`;

    await pump(data.file, fs.createWriteStream(path.join(FILE_DIR, fileName)));

    // Create a job on the whisper queue
    whisperQueue.push({
      fileName,
      language: "pt",
    });

    taskQueue.push(fileName);
    const positionInQueue = taskQueue.findIndex((t) => t === fileName);

    return {
      fileId,
      positionInQueue,
    };
  });

  app.get<{ Params: { fileId: string } }>(
    "/transcription/:fileId",
    async (req, res) => {
      let fileTranscription: string | null = null;
      try {
        fileTranscription = fs
          .readFileSync(path.join(FILE_DIR, `${req.params.fileId}.txt`))
          .toString();
      } catch (err) {
        fileTranscription = null;
      }

      const positionInQueue = taskQueue.findIndex(
        (t) => t.split(".").slice(0, -1).join(".") === req.params.fileId
      );

      return {
        ...(fileTranscription && { text: fileTranscription }),
        positionInQueue,
      };
    }
  );

  await app.listen({ port: 7072 });

  console.log(`Listening at http://localhost:7072`);
}

run();
