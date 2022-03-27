import { bold, yellow } from "std/fmt/colors";
import { Application, Router } from "oak";
import { oakCors } from "cors";
import { MongoClient } from "mongo";
import { createRoomFactory, findRoomFactory } from "./room.ts";

const app = new Application();
const router = new Router();

const mongo = new MongoClient();
await mongo.connect(Deno.env.get("MONGO_URI")!);

const roomsCol = mongo.database().collection("rooms");
const gamesCol = mongo.database().collection("games");

const createRoom = createRoomFactory(roomsCol);
const findRoom = findRoomFactory();

export const validateRoomParams = (
  params: { lang: string },
): ({ name: "lang"; reason: string })[] => {
  const invalids: ({ name: "lang"; reason: string })[] = [];

  if (!["ja"].includes(params.lang)) {
    invalids.push({
      name: "lang",
      reason: "unsupported lang",
    });
  }

  return invalids;
};

router.post("/room/create", async (context) => {
  if (!context.request.hasBody) {
    context.response.status = 400;
    context.response.body = {
      title: "Initial parameters are missing.",
    }; // TODO:
    return;
  }

  const body = context.request.body();
  const value = await body.value;
  const payload = JSON.parse(value);
  const { lang } = payload;

  const validated = validateRoomParams({ lang });
  if (0 < validated.length) {
    context.response.status = 400;
    context.response.body = {
      title: "Some initial pamameters are not valid.",
      invalid_params: validated,
    }; // TODO: RFC7807
    return;
  }

  try {
    const room = await createRoom();
    context.response.status = 200;
    context.response.body = {
      room_id: room.id,
      room_slug: room.slug,
    };
    return;
  } catch (e) {
    context.response.status = 500;
    context.response.body = {
      title: "Failed to create room.",
    }; // TODO: RFC7807
  }
});


router.get("/rooms/:slug/join", async (context) => {
  const { slug } = context.params;
  const room = findRoom(slug);
  if (!room) {
    context.response.status = 404;
    context.response.body = {
      title: "Active room was not found.",
    }; // TODO: RFC7807
    return;
  }

  const ws = await context.upgrade();
  room.addSocket(ws);
  return;
});

app.use(oakCors());
app.use(router.routes());
app.use(router.allowedMethods());
app.addEventListener("listen", ({ hostname, port, serverType }) => {
  console.log(bold(`Start listening on: ${yellow(`${hostname}:${port}`)}`));
  console.log(bold(`using HTTP server: ${yellow(serverType)}`));
});

await app.listen({
  port: parseInt(Deno.env.get("PORT") || "8000", 10),
});
console.log(bold("Finished."));
