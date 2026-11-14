/**
 * Which item properties a surface exposes. Kept in core (not exported from an SFC — `<script setup>`
 * is not a reliable place to export types from) so pages and components share one definition.
 *
 * Planning tasks deliberately show only priority + tags: a plan is about *finding* and ranking work,
 * not scheduling or delegating it. Archive items get the full set.
 */
export type PropertyField = 'priority' | 'due' | 'assignee' | 'tags';

export const ALL_PROPERTY_FIELDS: PropertyField[] = ['priority', 'due', 'assignee', 'tags'];
/** Planning: searchable/rankable only */
export const PLANNING_PROPERTY_FIELDS: PropertyField[] = ['priority', 'tags'];
