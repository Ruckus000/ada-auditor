import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Package generated delivery names only; no client paths or shell execution. */
public final class Archive {
    private Archive() {}
    public static void main(String[] args) throws Exception {
        if (args.length < 3 || args.length % 2 != 1 || args.length > 1001) throw new IllegalArgumentException("Invalid entries");
        long total = 0;
        int pdfs = 0;
        Set<String> names = new HashSet<>();
        for (int i = 1; i < args.length; i += 2) {
            String name = args[i + 1];
            if (!name.matches("[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*(?:\\.[A-Za-z0-9]+)?") || !names.add(name)) throw new IllegalArgumentException("Unsafe or duplicate name");
            total += Files.size(Path.of(args[i]));
            if (name.toLowerCase(java.util.Locale.ROOT).endsWith(".pdf")) pdfs++;
        }
        if (total > 100L * 1024 * 1024 || pdfs > 100) throw new IllegalArgumentException("Split this delivery");
        long copied = 0;
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(Path.of(args[0])))) {
            byte[] buffer = new byte[65536];
            for (int i = 1; i < args.length; i += 2) {
                ZipEntry entry = new ZipEntry(args[i + 1]);
                entry.setTime(0);
                zip.putNextEntry(entry);
                try (InputStream input = Files.newInputStream(Path.of(args[i]))) {
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        copied += count;
                        if (copied > 100L * 1024 * 1024) throw new IllegalArgumentException("Split this delivery");
                        zip.write(buffer, 0, count);
                    }
                }
                zip.closeEntry();
            }
        }
        System.out.println("{\"ok\":true}");
    }
}
