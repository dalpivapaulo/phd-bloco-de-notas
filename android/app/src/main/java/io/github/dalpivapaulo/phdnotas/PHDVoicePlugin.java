package io.github.dalpivapaulo.phdnotas;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.speech.RecognizerIntent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

@CapacitorPlugin(name = "PHDVoice")
public class PHDVoicePlugin extends Plugin {

    @PluginMethod
    public void listen(PluginCall call) {
        String language = call.getString("language", "pt-BR");
        String prompt = call.getString("prompt", "Fale o lembrete");

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, prompt);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);

        try {
            startActivityForResult(call, intent, "voiceResult");
        } catch (ActivityNotFoundException ex) {
            call.reject("Este aparelho não possui um serviço de reconhecimento de voz disponível.", "UNAVAILABLE", ex);
        } catch (Exception ex) {
            call.reject("Não foi possível abrir o ditado do Android.", "VOICE_START_FAILED", ex);
        }
    }

    @ActivityCallback
    private void voiceResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            call.reject("Ditado cancelado.", "CANCELED");
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("O reconhecimento de voz não retornou um resultado.", "NO_RESULT");
            return;
        }

        Intent data = result.getData();
        ArrayList<String> matches = data == null
                ? null
                : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);

        if (matches == null || matches.isEmpty() || matches.get(0) == null || matches.get(0).trim().isEmpty()) {
            call.reject("Nenhuma fala foi reconhecida.", "NO_SPEECH");
            return;
        }

        JSObject ret = new JSObject();
        ret.put("text", matches.get(0).trim());
        call.resolve(ret);
    }
}
