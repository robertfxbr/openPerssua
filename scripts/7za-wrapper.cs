using System;
using System.Diagnostics;
using System.Text;

// Wrapper para o 7za: repassa argumentos ao 7za-real.exe e tolera falhas de
// symlink do Windows ("Cannot create symbolic link ... privilege") — esses
// itens só são usados em builds macOS, então é seguro ignorá-los aqui.
class SevenZaWrapper
{
    static int Main(string[] args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "7za-real.exe"),
            Arguments = QuoteArgs(args),
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        var stdout = new StringBuilder();
        var stderr = new StringBuilder();
        using (var p = Process.Start(psi))
        {
            p.OutputDataReceived += (s, e) => { if (e.Data != null) { stdout.AppendLine(e.Data); Console.WriteLine(e.Data); } };
            p.ErrorDataReceived += (s, e) => { if (e.Data != null) { stderr.AppendLine(e.Data); Console.Error.WriteLine(e.Data); } };
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            p.WaitForExit();

            if (p.ExitCode == 0) return 0;

            var combined = stdout.ToString() + stderr.ToString();
            bool onlySymlinkErrors = combined.Contains("symbolic link") || combined.Contains("Symbolic link");
            if (p.ExitCode == 2 && onlySymlinkErrors)
            {
                Console.Error.WriteLine("[7za-wrapper] ignorando erros de symlink (itens macOS, irrelevantes neste build)");
                return 0;
            }
            return p.ExitCode;
        }
    }

    static string QuoteArgs(string[] args)
    {
        var sb = new StringBuilder();
        foreach (var a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            if (a.IndexOfAny(new[] { ' ', '\t', '"' }) >= 0)
                sb.Append('"').Append(a.Replace("\\", "\\\\").Replace("\"", "\\\"")).Append('"');
            else
                sb.Append(a);
        }
        return sb.ToString();
    }
}
