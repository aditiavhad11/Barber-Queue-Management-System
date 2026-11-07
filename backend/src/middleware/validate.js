/**
 * Express middleware for validating request data against Zod schemas.
 *
 * Usage examples:
 * 1. validate(bodySchema)                     // validates req.body
 * 2. validate({ body: schema, query: schema }) // validates multiple targets
 */
export function validate(schemaOrTargets) {
  return (req, _res, next) => {
    try {
      if (!schemaOrTargets) return next();

      // If a Zod schema is passed directly, validate req.body
      if (typeof schemaOrTargets.parse === "function") {
        req.body = schemaOrTargets.parse(req.body);
        return next();
      }

      // If an object with targets { body, query, params } is passed
      if (schemaOrTargets.params && typeof schemaOrTargets.params.parse === "function") {
        req.params = schemaOrTargets.params.parse(req.params);
      }
      if (schemaOrTargets.query && typeof schemaOrTargets.query.parse === "function") {
        req.query = schemaOrTargets.query.parse(req.query);
      }
      if (schemaOrTargets.body && typeof schemaOrTargets.body.parse === "function") {
        req.body = schemaOrTargets.body.parse(req.body);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export default validate;

