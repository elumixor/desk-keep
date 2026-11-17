import { authed } from "~/lib/http/authed";
import { addViewProperty } from "~/lib/views";
import { propertyDefinitionSchema } from "~/model/properties";

/** A column added in a view: to its first trait, so every page having it gets it. */
export default authed({ body: { definition: propertyDefinitionSchema } }, ({ caller, router, body }) =>
  addViewProperty(caller, router.id, body.definition),
);
