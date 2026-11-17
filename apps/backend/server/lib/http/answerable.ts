import { InvalidPropertyError } from "~/model/properties";
import { PropertyDefinitionError } from "~/model/script/define";
import { InvalidUrnError } from "~/model/urn";
import { ApiError } from "./api-error";

/** The error as an answer for the caller, when it is one: an `ApiError`, or a refusal from the model layer. */
export function answerable(error: unknown): ApiError | null {
  if (error instanceof ApiError) return error;
  if (
    error instanceof InvalidPropertyError ||
    error instanceof InvalidUrnError ||
    error instanceof PropertyDefinitionError
  )
    return new ApiError(error.message);
  return null;
}
