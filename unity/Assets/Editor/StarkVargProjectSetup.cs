#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

namespace StarkVarg.EditorTools
{
    /// <summary>
    /// One-time project settings the graphics rely on, applied when the project opens:
    /// Linear colour space (physically correct lighting and PBR), landscape-only on phones.
    /// Each setting is only written if it differs, so this does nothing after the first run.
    /// </summary>
    [InitializeOnLoad]
    static class StarkVargProjectSetup
    {
        static StarkVargProjectSetup()
        {
            EditorApplication.delayCall += Apply;
        }

        static void Apply()
        {
            if (PlayerSettings.colorSpace != ColorSpace.Linear)
            {
                PlayerSettings.colorSpace = ColorSpace.Linear;
                Debug.Log("Stark Varg: switched the project to Linear colour space (Edit > Project Settings > Player > Other Settings).");
            }
            if (PlayerSettings.defaultInterfaceOrientation != UIOrientation.AutoRotation || PlayerSettings.allowedAutorotateToPortrait)
            {
                PlayerSettings.defaultInterfaceOrientation = UIOrientation.AutoRotation;
                PlayerSettings.allowedAutorotateToPortrait = false;
                PlayerSettings.allowedAutorotateToPortraitUpsideDown = false;
                PlayerSettings.allowedAutorotateToLandscapeLeft = true;
                PlayerSettings.allowedAutorotateToLandscapeRight = true;
            }
        }
    }
}
#endif
