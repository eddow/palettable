<script setup lang="ts">
/**
 * `@palettable/vue` — head item dispatch (one SFC per control id).
 *
 * Vue equivalent of the vanilla `renderHeadItem` switch: resolves the
 * item's `control` id to its SFC. Unknown ids render nothing (the
 * configurator / console add-flow only offers known controls).
 */
import type { HeadContext } from '../head.js'
import ButtonTool from './ButtonTool.vue'
import CommandBoxTool from './CommandBoxTool.vue'
import DrawerTool from './DrawerTool.vue'
import SegmentedTool from './SegmentedTool.vue'
import SelectTool from './SelectTool.vue'
import SliderTool from './SliderTool.vue'
import StatusTool from './StatusTool.vue'
import StepperTool from './StepperTool.vue'
import ThemeTool from './ThemeTool.vue'
import ToggleTool from './ToggleTool.vue'

defineProps<{ context: HeadContext }>()

function controlOf(context: HeadContext): string | undefined {
	return (context.item as { control?: unknown }).control as string | undefined
}
</script>

<template>
	<ButtonTool v-if="controlOf(context) === 'button'" :context="context" />
	<ToggleTool v-else-if="controlOf(context) === 'toggle'" :context="context" />
	<SelectTool v-else-if="controlOf(context) === 'select'" :context="context" />
	<SegmentedTool v-else-if="controlOf(context) === 'segmented'" :context="context" />
	<SliderTool
		v-else-if="controlOf(context) === 'slider' || controlOf(context) === 'drawerSlider'"
		:context="context"
	/>
	<StepperTool v-else-if="controlOf(context) === 'stepper'" :context="context" />
	<StatusTool v-else-if="controlOf(context) === 'status'" :context="context" />
	<ThemeTool v-else-if="controlOf(context) === 'theme'" :context="context" />
	<CommandBoxTool v-else-if="controlOf(context) === 'commandBox'" :context="context" />
	<DrawerTool v-else-if="controlOf(context) === 'drawer'" :context="context" />
</template>
