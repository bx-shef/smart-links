<template>
  <!--
    Centring block for an advice/empty state.

    The height used to be `h-[calc(100vh-360px)]`. That is fine on a desktop slider and wrong
    everywhere else: in the Bitrix24 mobile client the slider viewport is short enough that the
    result is near zero (negative before the clamp), so the advice collapsed into a sliver and its
    button became unreachable. A floor plus padding grows with the content instead of fighting it.
  -->
  <div class="flex flex-col items-center justify-center gap-[10px] min-h-[240px] py-8">
    <slot />
  </div>
</template>
