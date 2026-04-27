import { createRouter } from "@remix-run/fetch-router";
import { renderToStream } from "@remix-run/component/server";

const router = createRouter();
router.get("/", () => {
  return new Response(renderToStream(
    <div>
      renderToStream sample
      <template>in template</template>
      after template
    </div>,
  ));
});

export default router;
