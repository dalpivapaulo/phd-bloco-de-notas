package io.github.dalpivapaulo.phdnotas;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PHDPrint")
public class PHDPrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        if (getActivity() == null || getBridge() == null) {
            call.reject("Tela Android indisponível para impressão.");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = getBridge().getWebView();
                if (webView == null) {
                    call.reject("WebView indisponível para impressão.");
                    return;
                }

                PrintManager printManager =
                        (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);

                if (printManager == null) {
                    call.reject("Serviço de impressão do Android indisponível.");
                    return;
                }

                String jobName = "PHD - Lembretes";
                PrintDocumentAdapter adapter =
                        webView.createPrintDocumentAdapter(jobName);

                PrintAttributes attributes = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                        .build();

                PrintJob job = printManager.print(jobName, adapter, attributes);

                if (job == null) {
                    call.reject("O Android não conseguiu criar o trabalho de impressão.");
                    return;
                }

                JSObject result = new JSObject();
                result.put("opened", true);
                call.resolve(result);

            } catch (Exception e) {
                call.reject(
                        "Falha ao abrir a impressão: " +
                        (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()),
                        e
                );
            }
        });
    }
}
