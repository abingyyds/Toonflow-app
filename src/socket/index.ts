import { Server } from "socket.io";
import productionAgent from "./routes/productionAgent";
import scriptAgent from "./routes/scriptAgent";

export default (io: Server) => {
  const routes: Record<string, (nsp: ReturnType<Server["of"]>) => void> = {
    productionAgent,
    scriptAgent,
  };

  for (const [name, handler] of Object.entries(routes)) {
    for (const namespace of [`/api/socket/${name}`, `/socket/${name}`]) {
      const nsp = io.of(namespace);
      handler(nsp);
      console.log(`[Socket] 注册命名空间: ${namespace}`);
    }
  }
};
