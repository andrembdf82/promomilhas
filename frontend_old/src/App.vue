<template>
  <div class="p-4">
    <h1>📱 WhatsApp Bot</h1>
    <ul>
      <li v-for="(msg, index) in messages" :key="index">
        <strong>{{ msg.chatName }}:</strong> {{ msg.body }}
      </li>
    </ul>
  </div>
</template>

<script>
export default {
  data() {
    return {
      messages: []
    };
  },
  mounted() {
    const socket = new WebSocket('ws://localhost:3001');
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'message') {
        this.messages.push(data);
      }
    };
  }
};
</script>

<style>
body {
  font-family: sans-serif;
  background: #f4f4f4;
}
</style>
