import {z} from 'zod';
import {actionPayloadSchemas,suggestedActionSchema,type SocratesActionTypeInput} from '../modules/socrates/actions.schemas.js';
import {answerSchema,citationSchema} from '../modules/socrates/schemas.js';

// The public suggestion schema validates an unknown payload with a refinement.
// JSON Schema conversion cannot express that refinement, so expose the existing
// action-specific shapes on the desktop wire without changing the public shape.
const suggestionShape=z.strictObject(suggestedActionSchema.shape);
function suggestion<T extends SocratesActionTypeInput>(type:T){
 return suggestionShape.extend({type:z.literal(type),payload:actionPayloadSchemas[type]});
}
const desktopSuggestedActionSchema=z.discriminatedUnion('type',[
 suggestion('generate_prd'),
 suggestion('generate_srs'),
 suggestion('create_context_note'),
 suggestion('create_diagram'),
 suggestion('embed_diagram_in_live_doc'),
 suggestion('generate_coding_requirements'),
 suggestion('create_responsibility'),
 suggestion('assign_task'),
 suggestion('update_team_member_responsibility'),
 suggestion('create_calendar_event')
]);
/** Only the known product answer is transformed. Every wire property is required:
 * defaulted values are explicit, and null represents an absent optional value.
 * Explicitly nullable domain fields retain null. Original validation runs after
 * this wire parse, so refinements (secrets, dates, ownership) are never bypassed.
 */
function strictAnswerWireSchema(input:z.ZodTypeAny):z.ZodTypeAny{
 let nodes=0;
 const visit=(schema:z.ZodTypeAny,depth:number):z.ZodTypeAny=>{
  if(depth>64||++nodes>10000)throw new Error('Desktop answer schema exceeds supported complexity.');
  const next=(child:z.core.$ZodType)=>visit(child as z.ZodTypeAny,depth+1);
  if(schema instanceof z.ZodDefault)return next(schema.removeDefault());
  if(schema instanceof z.ZodOptional){
   const inner=schema.unwrap(),wire=next(inner);
   return (inner as z.ZodTypeAny).safeParse(null).success?wire:z.union([wire,z.null()]).overwrite(value=>value===null?undefined:value);
  }
  if(schema instanceof z.ZodNullable)return z.union([next(schema.unwrap()),z.null()]);
  if(schema instanceof z.ZodObject)return z.strictObject(Object.fromEntries(Object.entries(schema.shape).map(([key,child])=>[key,next(child as z.ZodTypeAny)])));
  // Retain this array's existing min/max/exact bounds while replacing its item.
  if(schema instanceof z.ZodArray)return new z.ZodArray({...schema.def,element:next(schema.element)});
  if(schema instanceof z.ZodUnion||schema instanceof z.ZodDiscriminatedUnion){
   return z.union(schema.options.map(next) as [z.ZodTypeAny,z.ZodTypeAny,...z.ZodTypeAny[]]);
  }
  if(schema instanceof z.ZodString||schema instanceof z.ZodNumber||schema instanceof z.ZodBoolean||schema instanceof z.ZodEnum||schema instanceof z.ZodLiteral||schema instanceof z.ZodNull)return schema;
  throw new Error('Unsupported desktop answer schema type.');
 };
 return visit(input,0);
}
const desktopAnswerWireSchema=strictAnswerWireSchema(answerSchema.extend({
 suggested_actions:z.array(desktopSuggestedActionSchema).max(5)
}));
const desktopCitationWireSchema=strictAnswerWireSchema(citationSchema);

/** Wire representation only. The caller MUST still parse the returned provider
 * JSON with its original input schema, which owns secret checks, cross-field
 * refinements and confirmation semantics. Unrecognised schemas pass unchanged.
 */
export function getDesktopProductWireSchema(schema:z.ZodTypeAny):z.ZodTypeAny{
 return schema===answerSchema?desktopAnswerWireSchema:schema===citationSchema?desktopCitationWireSchema:schema;
}
