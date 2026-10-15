import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import java.io.*;
import java.net.*;

/**
 * Deliberately vulnerable target for CVE-2021-44228 (Log4Shell) lab exercises.
 * Logs the request line and User-Agent header through Log4j 2.14, so an
 * attacker-controlled header reaches Logger.error() unsanitised. Ships only
 * in LabForge's docker_roles build context; never built outside a lab.
 */
public class VulnApp {
  private static final Logger logger = LogManager.getLogger(VulnApp.class);

  public static void main(String[] args) throws Exception {
    ServerSocket ss = new ServerSocket(8080);
    System.out.println("VulnApp listening on :8080");
    while (true) {
      Socket s = ss.accept();
      try {
        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream()));
        String line = in.readLine();
        String ua = "unknown";
        String l;
        while ((l = in.readLine()) != null && !l.isEmpty()) {
          if (l.toLowerCase().startsWith("user-agent:")) ua = l.substring(11).trim();
        }
        logger.error("Received request {} ua={}", line, ua);
        PrintWriter out = new PrintWriter(s.getOutputStream(), true);
        out.println("HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nok");
      } finally {
        s.close();
      }
    }
  }
}
