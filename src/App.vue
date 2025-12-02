<script setup></script>

<template>
  <RouterView />
</template>

<style>
/* 全局重置，确保占满全屏 */
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

body {
  background-color: #f5f5f7;
  font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}
</style>
