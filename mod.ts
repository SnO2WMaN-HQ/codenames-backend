import { bold, yellow } from "std/fmt/colors";
import { Application, Router } from "oak";
import { oakCors } from "cors";
import { Bson, MongoClient } from "mongo";
import { generateSlug } from "https://cdn.skypack.dev/random-word-slugs?dts";

const app = new Application();
const router = new Router();

const mongo = new MongoClient();
await mongo.connect(Deno.env.get("MONGO_URI")!);

const roomsCol = mongo.database().collection("rooms");
const gamesCol = mongo.database().collection("games");

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
export const createRoom = async (
  params: { lang: string },
): Promise<{ id: string; slug: string }> => {
  const slug = generateSlug(3, { format: "kebab" });

  const oid: Bson.ObjectId = await roomsCol.insertOne({
    slug: slug,
    expired: false,
    createdAt: new Date(),
  });

  return { id: oid.toString(), slug };
};

router.post("/create/room", async (context) => {
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
    const room = await createRoom({ lang });
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
