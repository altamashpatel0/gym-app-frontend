package com.gym.management.tool;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import com.gym.management.tool.sync.LocalLanSyncPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getBridge().registerPlugin(
                LocalLanSyncPlugin.class
        );
    }
}