package com.codexnovel.reader

import android.app.Application

class ReaderApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Graph.init(this)
    }
}
