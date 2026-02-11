export const Session = {
  socket: null,
  myId: null,
  room: null,
  dataset: [],
  name: "PLAYER",
  globalLB: [],
  get isHost() {
    return Session.room?.hostId === Session.myId;
  }
};
